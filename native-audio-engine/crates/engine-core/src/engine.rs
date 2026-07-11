use std::time::Instant;

use engine_dsp::{DiagnosticOscillator, PARAM_DIAGNOSTIC_FREQUENCY, PARAM_DIAGNOSTIC_GAIN};
use engine_protocol::{
    AudioTelemetry, CommandDiagnostics, CommandRejection, EngineCommand, EngineEvent,
    NativeExecutionPlan, RuntimePlanStatus, ScheduledBeatEvent, ScheduledEngineEvent,
    TempoMapSnapshot, TransportLoop,
};

use crate::{
    EngineCommandReceiver, EngineTelemetrySender, PendingPlanSet, PlanValidationError,
    PreparedExecutionPlan, PreparedPlanReceiver, ProcessContext, ProcessRange,
    RetiredExecutionPlan, RetiredPlanSender, RETIRED_PLAN_TRANSFER_CAPACITY,
};

const PENDING_COMMAND_CAPACITY: usize = 1024;
const SCHEDULED_EVENT_CAPACITY: usize = 2048;
const COMMITTED_SCHEDULING_HORIZON_SAMPLES: u64 = 128;
const DEFAULT_PLAN_CROSSFADE_SAMPLES: u32 = 128;
const DEFERRED_RETIREMENT_CAPACITY: usize = RETIRED_PLAN_TRANSFER_CAPACITY * 2;

#[derive(Clone, Copy, Debug, PartialEq)]
struct DiagnosticSignalState {
    enabled: bool,
    oscillator: DiagnosticOscillator,
    panic_muted: bool,
}

impl DiagnosticSignalState {
    fn disabled() -> Self {
        Self {
            enabled: false,
            oscillator: DiagnosticOscillator::default(),
            panic_muted: false,
        }
    }
}

struct ActivePlanCrossfade {
    old_plan: Option<PreparedExecutionPlan>,
    new_plan: Option<PreparedExecutionPlan>,
    total_samples: u32,
    processed_samples: u32,
}

impl ActivePlanCrossfade {
    fn remaining_samples(&self) -> u32 {
        self.total_samples.saturating_sub(self.processed_samples)
    }

    fn is_complete(&self) -> bool {
        self.processed_samples >= self.total_samples
    }
}

struct DeferredRetirements {
    slots: [Option<RetiredExecutionPlan>; DEFERRED_RETIREMENT_CAPACITY],
}

impl Default for DeferredRetirements {
    fn default() -> Self {
        Self {
            slots: std::array::from_fn(|_| None),
        }
    }
}

impl DeferredRetirements {
    fn push(&mut self, retired: RetiredExecutionPlan) -> Result<(), RetiredExecutionPlan> {
        if let Some(slot) = self.slots.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(retired);
            return Ok(());
        }

        Err(retired)
    }

    fn pop(&mut self) -> Option<RetiredExecutionPlan> {
        let slot = self.slots.iter_mut().find(|slot| slot.is_some())?;

        slot.take()
    }

    fn is_full(&self) -> bool {
        self.slots.iter().all(Option::is_some)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ScheduledEventEntry {
    event: ScheduledEngineEvent,
    original_sample: u64,
    loop_iteration: u64,
    beat_event: Option<ScheduledBeatEvent>,
}

impl ScheduledEventEntry {
    fn effective_sample(&self) -> u64 {
        self.event.at_sample()
    }
}

struct ScheduledEventSet {
    entries: [Option<ScheduledEventEntry>; SCHEDULED_EVENT_CAPACITY],
}

impl Default for ScheduledEventSet {
    fn default() -> Self {
        Self {
            entries: [None; SCHEDULED_EVENT_CAPACITY],
        }
    }
}

impl ScheduledEventSet {
    fn insert(
        &mut self,
        event: ScheduledEngineEvent,
        beat_event: Option<ScheduledBeatEvent>,
    ) -> Result<(), ScheduledEngineEvent> {
        let entry = ScheduledEventEntry {
            event,
            original_sample: event.at_sample(),
            loop_iteration: 0,
            beat_event,
        };

        if let Some(slot) = self.entries.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(entry);
            return Ok(());
        }

        Err(event)
    }

    fn insert_entry(&mut self, entry: ScheduledEventEntry) -> Result<(), ScheduledEventEntry> {
        if let Some(slot) = self.entries.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(entry);
            return Ok(());
        }

        Err(entry)
    }

    fn take_due_before(&mut self, sample: u64) -> Option<ScheduledEventEntry> {
        let index = self
            .entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| {
                let entry = entry.as_ref()?;

                (entry.effective_sample() <= sample).then_some((index, entry.effective_sample()))
            })
            .min_by_key(|(_, effective_sample)| *effective_sample)
            .map(|(index, _)| index)?;

        self.entries[index].take()
    }

    fn clear(&mut self) {
        self.entries.fill(None);
    }

    fn is_empty(&self) -> bool {
        self.entries.iter().all(Option::is_none)
    }

    fn retime_beat_events_outside_horizon(&mut self, tempo: TempoMapSnapshot, horizon_sample: u64) {
        for entry in self.entries.iter_mut().filter_map(Option::as_mut) {
            if entry.event.at_sample() < horizon_sample {
                continue;
            }

            let Some(beat_event) = entry.beat_event else {
                continue;
            };

            entry.event = beat_event.to_sample_event(tempo);
            entry.original_sample = entry.event.at_sample();
            entry.loop_iteration = 0;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ScheduledTestVoice {
    enabled: bool,
    active: bool,
    oscillator: DiagnosticOscillator,
}

impl ScheduledTestVoice {
    fn disabled() -> Self {
        Self {
            enabled: false,
            active: false,
            oscillator: DiagnosticOscillator::default(),
        }
    }

    fn enable(&mut self) {
        self.enabled = true;
    }

    fn note_on(&mut self, note: u8, velocity: f32) {
        self.active = true;
        self.oscillator.set_frequency(midi_note_frequency(note));
        self.oscillator.set_gain_target(velocity.clamp(0.0, 1.0), 0);
    }

    fn note_off(&mut self) {
        self.active = false;
        self.oscillator.set_gain_target(0.0, 0);
    }

    fn panic(&mut self) {
        self.active = false;
        self.oscillator.reset();
        self.oscillator.set_gain_target(0.0, 0);
    }
}

fn midi_note_frequency(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

fn set_scheduled_event_sample(event: ScheduledEngineEvent, at_sample: u64) -> ScheduledEngineEvent {
    match event {
        ScheduledEngineEvent::NoteOn {
            target_node,
            note,
            velocity,
            ..
        } => ScheduledEngineEvent::NoteOn {
            target_node,
            note,
            velocity,
            at_sample,
        },
        ScheduledEngineEvent::NoteOff {
            target_node, note, ..
        } => ScheduledEngineEvent::NoteOff {
            target_node,
            note,
            at_sample,
        },
    }
}

pub struct AudioEngine {
    sample_position: u64,
    callback_count: u64,
    maximum_callback_duration_ns: u64,
    stream_errors: u64,
    probable_xruns: u64,
    playing: bool,
    last_parameter: Option<(u32, f32)>,
    diagnostic_signal: DiagnosticSignalState,
    scheduled_test_voice: ScheduledTestVoice,
    tempo_map: TempoMapSnapshot,
    transport_loop: TransportLoop,
    scheduled_events: ScheduledEventSet,
    execution_plan: Option<PreparedExecutionPlan>,
    crossfade: Option<ActivePlanCrossfade>,
    deferred_retirements: DeferredRetirements,
    pending_plans: PendingPlanSet,
    prepared_plan_receiver: Option<PreparedPlanReceiver>,
    retired_plan_sender: Option<RetiredPlanSender>,
    successful_plan_swaps: u64,
    rejected_plan_swaps: u64,
    command_diagnostics: CommandDiagnostics,
    pending_commands: Vec<EngineCommand>,
    processing_commands: Vec<EngineCommand>,
    block_commands: Vec<EngineCommand>,
    command_receiver: Option<EngineCommandReceiver>,
    telemetry_sender: Option<EngineTelemetrySender>,
    last_received_command_sample: Option<u64>,
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            sample_position: 0,
            callback_count: 0,
            maximum_callback_duration_ns: 0,
            stream_errors: 0,
            probable_xruns: 0,
            playing: false,
            last_parameter: None,
            diagnostic_signal: DiagnosticSignalState::disabled(),
            scheduled_test_voice: ScheduledTestVoice::disabled(),
            tempo_map: TempoMapSnapshot::default(),
            transport_loop: TransportLoop {
                enabled: false,
                start_sample: 0,
                end_sample: 0,
            },
            scheduled_events: ScheduledEventSet::default(),
            execution_plan: None,
            crossfade: None,
            deferred_retirements: DeferredRetirements::default(),
            pending_plans: PendingPlanSet::default(),
            prepared_plan_receiver: None,
            retired_plan_sender: None,
            successful_plan_swaps: 0,
            rejected_plan_swaps: 0,
            command_diagnostics: CommandDiagnostics::default(),
            pending_commands: Vec::with_capacity(PENDING_COMMAND_CAPACITY),
            processing_commands: Vec::with_capacity(PENDING_COMMAND_CAPACITY),
            block_commands: Vec::with_capacity(PENDING_COMMAND_CAPACITY),
            command_receiver: None,
            telemetry_sender: None,
            last_received_command_sample: None,
        }
    }

    pub fn with_diagnostic_signal(mut self) -> Self {
        self.diagnostic_signal.enabled = true;
        self
    }

    pub fn with_scheduled_test_voice(mut self) -> Self {
        self.scheduled_test_voice.enable();
        self
    }

    pub fn with_execution_plan(
        mut self,
        plan: &NativeExecutionPlan,
        maximum_frames: usize,
    ) -> Result<Self, PlanValidationError> {
        self.execution_plan = Some(PreparedExecutionPlan::prepare(plan, maximum_frames)?);
        Ok(self)
    }

    pub fn with_prepared_execution_plan(mut self, plan: PreparedExecutionPlan) -> Self {
        self.execution_plan = Some(plan);
        self
    }

    pub fn with_realtime_queues(
        mut self,
        command_receiver: EngineCommandReceiver,
        telemetry_sender: EngineTelemetrySender,
    ) -> Self {
        self.command_receiver = Some(command_receiver);
        self.telemetry_sender = Some(telemetry_sender);
        self
    }

    pub fn with_plan_transfer_queues(
        mut self,
        prepared_plan_receiver: PreparedPlanReceiver,
        retired_plan_sender: RetiredPlanSender,
    ) -> Self {
        self.prepared_plan_receiver = Some(prepared_plan_receiver);
        self.retired_plan_sender = Some(retired_plan_sender);
        self
    }

    pub fn sample_position(&self) -> u64 {
        self.sample_position
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn last_parameter(&self) -> Option<(u32, f32)> {
        self.last_parameter
    }

    pub fn diagnostic_frequency_hz(&self) -> f32 {
        self.diagnostic_signal.oscillator.frequency_hz()
    }

    pub fn diagnostic_gain(&self) -> f32 {
        self.diagnostic_signal.oscillator.gain()
    }

    pub fn diagnostic_phase(&self) -> f64 {
        self.diagnostic_signal.oscillator.phase()
    }

    pub fn command_diagnostics(&self) -> CommandDiagnostics {
        self.command_diagnostics
    }

    pub fn tempo_map(&self) -> TempoMapSnapshot {
        self.tempo_map
    }

    pub fn scheduled_events_empty(&self) -> bool {
        self.scheduled_events.is_empty()
    }

    pub fn process(&mut self, output: &mut [f32], context: ProcessContext) -> AudioTelemetry {
        let started_at = Instant::now();

        let block_start = self.sample_position;
        let block_end = block_start.saturating_add(context.frame_count as u64);

        self.drain_command_queue();
        self.prepare_block_commands();
        self.drain_plan_transfers();
        self.flush_deferred_retirement();
        self.apply_block_boundary_swaps(block_start, block_end);
        self.render_block(output, context, block_start, block_end);

        self.sample_position = self
            .sample_position
            .saturating_add(context.frame_count as u64);
        self.callback_count = self.callback_count.saturating_add(1);

        let callback_duration_ns = started_at.elapsed().as_nanos() as u64;
        self.maximum_callback_duration_ns =
            self.maximum_callback_duration_ns.max(callback_duration_ns);

        let available_ns =
            (context.frame_count as f64 / context.sample_rate * 1_000_000_000.0).max(1.0);
        let callback_load = (callback_duration_ns as f64 / available_ns) as f32;

        if callback_load > 1.0 {
            self.probable_xruns = self.probable_xruns.saturating_add(1);
        }

        AudioTelemetry {
            sample_position: self.sample_position,
            callback_count: self.callback_count,
            sample_rate: context.sample_rate.round() as u32,
            callback_frames: context.frame_count,
            output_channels: context.output_channels,
            callback_duration_ns,
            maximum_callback_duration_ns: self.maximum_callback_duration_ns,
            callback_load,
            stream_errors: self.stream_errors,
            probable_xruns: self.probable_xruns,
            command_queue_depth: self
                .command_receiver
                .as_ref()
                .map(|receiver| receiver.len() as u32)
                .unwrap_or(0),
            pending_command_count: self.pending_commands.len() as u32,
            command_diagnostics: self.current_command_diagnostics(),
            runtime_plan_status: self.runtime_plan_status(),
        }
    }

    fn runtime_plan_status(&self) -> RuntimePlanStatus {
        RuntimePlanStatus {
            active_plan_id: self
                .execution_plan
                .as_ref()
                .map(PreparedExecutionPlan::plan_id)
                .or_else(|| {
                    self.crossfade
                        .as_ref()
                        .and_then(|crossfade| crossfade.new_plan.as_ref())
                        .map(PreparedExecutionPlan::plan_id)
                }),
            active_plan_revision: self
                .execution_plan
                .as_ref()
                .map(PreparedExecutionPlan::plan_revision)
                .or_else(|| {
                    self.crossfade
                        .as_ref()
                        .and_then(|crossfade| crossfade.new_plan.as_ref())
                        .map(PreparedExecutionPlan::plan_revision)
                }),
            pending_plan_count: self.pending_plans.len() as u32,
            successful_swaps: self.successful_plan_swaps,
            rejected_swaps: self.rejected_plan_swaps,
        }
    }

    fn prepare_block_commands(&mut self) {
        self.processing_commands.clear();
        std::mem::swap(&mut self.pending_commands, &mut self.processing_commands);
    }

    fn drain_plan_transfers(&mut self) {
        loop {
            let transfer = self
                .prepared_plan_receiver
                .as_ref()
                .and_then(PreparedPlanReceiver::pop);
            let Some(transfer) = transfer else {
                break;
            };

            let transfer_id = transfer.transfer_id;
            let reason = if self.pending_plans.contains_transfer_id(transfer_id) {
                CommandRejection::DuplicatePreparedPlan
            } else if self.pending_plans.is_full() {
                CommandRejection::PendingPlanFull
            } else {
                CommandRejection::PendingPlanFull
            };

            if let Err(transfer) = self.pending_plans.insert(transfer) {
                self.rejected_plan_swaps = self.rejected_plan_swaps.saturating_add(1);
                self.retire_unactivated_transfer(transfer);
                self.publish_event(EngineEvent::CommandRejected {
                    command_id: transfer_id,
                    reason,
                });
            }
        }
    }

    fn retire_unactivated_transfer(&mut self, transfer: crate::PreparedPlanTransfer) {
        self.retire_or_defer(RetiredExecutionPlan {
            plan_id: transfer.plan_id,
            plan_revision: transfer.plan_revision,
            plan: transfer.plan,
        });
    }

    fn can_accept_retired_plan(&self) -> bool {
        !self.deferred_retirements.is_full()
            && self
                .retired_plan_sender
                .as_ref()
                .is_some_and(|sender| !sender.is_full())
    }

    fn flush_deferred_retirement(&mut self) {
        loop {
            let Some(retired) = self.deferred_retirements.pop() else {
                return;
            };

            let Some(sender) = self.retired_plan_sender.as_ref() else {
                let _ = self.deferred_retirements.push(retired);
                return;
            };

            if let Err(retired) = sender.push(retired) {
                let _ = self.deferred_retirements.push(retired);
                return;
            }
        }
    }

    fn retire_or_defer(&mut self, retired: RetiredExecutionPlan) {
        let Some(sender) = self.retired_plan_sender.as_ref() else {
            let _ = self.deferred_retirements.push(retired);
            return;
        };

        if let Err(retired) = sender.push(retired) {
            let _ = self.deferred_retirements.push(retired);
        }
    }

    fn apply_block_boundary_swaps(&mut self, block_start: u64, _block_end: u64) {
        self.pending_commands.clear();
        self.block_commands.clear();

        for index in 0..self.processing_commands.len() {
            let command = self.processing_commands[index];

            match command {
                EngineCommand::SwapExecutionPlan {
                    requested_sample, ..
                } if requested_sample <= block_start => {
                    self.apply_swap_command(command, block_start);
                }
                EngineCommand::SwapExecutionPlan { .. } => {
                    self.pending_commands.push(command);
                }
                _ => {
                    self.block_commands.push(command);
                }
            }
        }

        self.processing_commands.clear();
        std::mem::swap(&mut self.block_commands, &mut self.processing_commands);
    }

    fn apply_swap_command(&mut self, command: EngineCommand, applied_sample: u64) {
        let EngineCommand::SwapExecutionPlan {
            id,
            transfer_id,
            requested_sample,
        } = command
        else {
            return;
        };

        if self.crossfade.is_some() {
            if let Some(transfer) = self.pending_plans.take(transfer_id) {
                self.retire_unactivated_transfer(transfer);
            }
            self.reject_swap_command(id, CommandRejection::SwapInProgress);
            return;
        }

        let Some(mut transfer) = self.pending_plans.take(transfer_id) else {
            self.reject_swap_command(id, CommandRejection::MissingPreparedPlan);
            return;
        };

        if let Some(old_plan) = self.execution_plan.as_ref() {
            if transfer
                .plan
                .apply_state_transfer_from(old_plan, &transfer.state_transfer)
                .is_err()
            {
                self.retire_unactivated_transfer(transfer);
                self.reject_swap_command(id, CommandRejection::InvalidStateTransfer);
                return;
            }
        } else if !transfer.state_transfer.entries.is_empty() {
            self.retire_unactivated_transfer(transfer);
            self.reject_swap_command(id, CommandRejection::InvalidStateTransfer);
            return;
        }

        let plan_id = transfer.plan_id;
        let plan_revision = transfer.plan_revision;

        let Some(old_plan) = self.execution_plan.take() else {
            self.execution_plan = Some(transfer.plan);
            self.successful_plan_swaps = self.successful_plan_swaps.saturating_add(1);
            self.command_diagnostics.applied = self.command_diagnostics.applied.saturating_add(1);
            self.publish_event(EngineEvent::ExecutionPlanSwapped {
                command_id: id,
                plan_id,
                plan_revision,
                requested_sample,
                applied_sample,
            });
            return;
        };

        if !self.can_accept_retired_plan() {
            let _ = self.pending_plans.insert(transfer);
            self.execution_plan = Some(old_plan);
            self.reject_swap_command(id, CommandRejection::RetirementQueueFull);
            return;
        }

        self.crossfade = Some(ActivePlanCrossfade {
            old_plan: Some(old_plan),
            new_plan: Some(transfer.plan),
            total_samples: DEFAULT_PLAN_CROSSFADE_SAMPLES,
            processed_samples: 0,
        });
        self.successful_plan_swaps = self.successful_plan_swaps.saturating_add(1);
        self.command_diagnostics.applied = self.command_diagnostics.applied.saturating_add(1);
        self.publish_event(EngineEvent::ExecutionPlanSwapped {
            command_id: id,
            plan_id,
            plan_revision,
            requested_sample,
            applied_sample,
        });
    }

    fn reject_swap_command(&mut self, command_id: u64, reason: CommandRejection) {
        self.rejected_plan_swaps = self.rejected_plan_swaps.saturating_add(1);
        self.reject_command(command_id, reason);
    }

    fn render_block(
        &mut self,
        output: &mut [f32],
        context: ProcessContext,
        block_start: u64,
        block_end: u64,
    ) {
        output.fill(0.0);

        if self.execution_plan.is_some() || self.crossfade.is_some() {
            self.render_execution_plan(output, context, block_start, block_end);
            return;
        }

        if self.scheduled_test_voice.enabled {
            self.render_scheduled_test_voice(output, context, block_start, block_end);
            return;
        }

        self.render_diagnostic_signal(output, context, block_start, block_end);
    }

    fn render_execution_plan(
        &mut self,
        output: &mut [f32],
        context: ProcessContext,
        block_start: u64,
        block_end: u64,
    ) {
        let frame_count = context.frame_count as usize;

        if !self.can_render_plan_output(frame_count, context.output_channels.max(1) as usize) {
            self.stream_errors = self.stream_errors.saturating_add(1);
            self.publish_event(EngineEvent::StreamError { code: 1 });
            self.retain_all_processing_commands();
            return;
        }

        let mut command_index = 0;
        let mut current_frame = 0;

        while current_frame < frame_count {
            let sample_position = block_start.saturating_add(current_frame as u64);
            command_index = self.apply_commands_until(command_index, block_start, sample_position);

            let next_frame = self
                .next_command_frame(command_index, block_start, block_end)
                .unwrap_or(frame_count)
                .min(frame_count);
            let next_frame = self
                .next_scheduled_event_frame(block_start, block_end)
                .map(|frame| next_frame.min(frame))
                .unwrap_or(next_frame);
            let next_frame = self
                .crossfade
                .as_ref()
                .map(|crossfade| {
                    next_frame
                        .min(current_frame.saturating_add(crossfade.remaining_samples() as usize))
                })
                .unwrap_or(next_frame);

            if current_frame < next_frame && self.playing {
                let range = ProcessRange {
                    start_frame: current_frame,
                    end_frame: next_frame,
                };

                if self.crossfade.is_some() {
                    if !self.render_crossfade_range(output, context, range) {
                        self.stream_errors = self.stream_errors.saturating_add(1);
                        self.publish_event(EngineEvent::StreamError { code: 1 });
                        self.retain_all_processing_commands();
                        return;
                    }
                } else {
                    let plan = self
                        .execution_plan
                        .as_mut()
                        .expect("execution plan should exist while rendering");

                    plan.clear_range(range);
                    plan.process(
                        output,
                        context.sample_rate,
                        context.output_channels.max(1) as usize,
                        range,
                    );
                }
            } else if current_frame < next_frame {
                self.advance_silent_crossfade(next_frame - current_frame);
            }

            current_frame = next_frame;
            self.apply_scheduled_events_until(block_start.saturating_add(current_frame as u64));

            if self
                .crossfade
                .as_ref()
                .is_some_and(ActivePlanCrossfade::is_complete)
            {
                self.finish_crossfade();
            }
        }

        self.retain_future_commands(command_index, block_end);
    }

    fn render_scheduled_test_voice(
        &mut self,
        output: &mut [f32],
        context: ProcessContext,
        block_start: u64,
        block_end: u64,
    ) {
        let channels = context.output_channels.max(1) as usize;
        let frame_count = context.frame_count as usize;
        let mut command_index = 0;
        let mut current_frame = 0;

        while current_frame < frame_count {
            let sample_position = block_start.saturating_add(current_frame as u64);
            command_index = self.apply_commands_until(command_index, block_start, sample_position);
            self.apply_scheduled_events_until(sample_position);

            let next_frame = self
                .next_command_frame(command_index, block_start, block_end)
                .unwrap_or(frame_count)
                .min(frame_count);
            let next_frame = self
                .next_scheduled_event_frame(block_start, block_end)
                .map(|frame| next_frame.min(frame))
                .unwrap_or(next_frame);

            if current_frame < next_frame
                && self.playing
                && self.scheduled_test_voice.active
                && !self.diagnostic_signal.panic_muted
            {
                for frame in current_frame..next_frame {
                    let sample = self
                        .scheduled_test_voice
                        .oscillator
                        .next_sample(context.sample_rate);
                    let frame_start = frame * channels;
                    let frame_end = frame_start + channels;

                    for output_sample in &mut output[frame_start..frame_end] {
                        *output_sample = sample;
                    }
                }
            }

            current_frame = next_frame;
            self.apply_scheduled_events_until(block_start.saturating_add(current_frame as u64));
        }

        self.retain_future_commands(command_index, block_end);
    }

    fn can_render_plan_output(&self, frame_count: usize, output_channels: usize) -> bool {
        if let Some(crossfade) = self.crossfade.as_ref() {
            return crossfade.old_plan.as_ref().is_some_and(|plan| {
                frame_count <= plan.maximum_frames() && output_channels <= plan.output_channels()
            }) && crossfade.new_plan.as_ref().is_some_and(|plan| {
                frame_count <= plan.maximum_frames() && output_channels <= plan.output_channels()
            });
        }

        self.execution_plan
            .as_ref()
            .map(|plan| frame_count <= plan.maximum_frames())
            .unwrap_or(false)
    }

    fn render_crossfade_range(
        &mut self,
        output: &mut [f32],
        context: ProcessContext,
        range: ProcessRange,
    ) -> bool {
        let channels = context.output_channels.max(1) as usize;
        let Some(crossfade) = self.crossfade.as_mut() else {
            return false;
        };
        let Some(old_plan) = crossfade.old_plan.as_mut() else {
            return false;
        };
        let Some(new_plan) = crossfade.new_plan.as_mut() else {
            return false;
        };
        let Some(old_output) = old_plan.process_to_scratch(context.sample_rate, channels, range)
        else {
            return false;
        };
        let Some(new_output) = new_plan.process_to_scratch(context.sample_rate, channels, range)
        else {
            return false;
        };

        for frame in range.start_frame..range.end_frame {
            let fade_sample = crossfade.processed_samples + (frame - range.start_frame) as u32;
            let t = (fade_sample as f32 / crossfade.total_samples.max(1) as f32).clamp(0.0, 1.0);
            let old_gain = 1.0 - t;
            let new_gain = t;
            let frame_start = frame * channels;
            let frame_end = frame_start + channels;

            for sample_index in frame_start..frame_end {
                output[sample_index] =
                    old_output[sample_index] * old_gain + new_output[sample_index] * new_gain;
            }
        }

        crossfade.processed_samples = crossfade
            .processed_samples
            .saturating_add((range.end_frame - range.start_frame) as u32)
            .min(crossfade.total_samples);
        true
    }

    fn advance_silent_crossfade(&mut self, frame_count: usize) {
        let Some(crossfade) = self.crossfade.as_mut() else {
            return;
        };

        crossfade.processed_samples = crossfade
            .processed_samples
            .saturating_add(frame_count as u32)
            .min(crossfade.total_samples);
    }

    fn finish_crossfade(&mut self) {
        let Some(mut crossfade) = self.crossfade.take() else {
            return;
        };

        if !crossfade.is_complete() {
            self.crossfade = Some(crossfade);
            return;
        }

        let Some(old_plan) = crossfade.old_plan.take() else {
            self.crossfade = Some(crossfade);
            return;
        };
        let Some(new_plan) = crossfade.new_plan.take() else {
            self.crossfade = Some(crossfade);
            return;
        };
        let retired = RetiredExecutionPlan {
            plan_id: old_plan.plan_id(),
            plan_revision: old_plan.plan_revision(),
            plan: old_plan,
        };

        self.retire_or_defer(retired);
        self.execution_plan = Some(new_plan);
    }

    fn next_command_frame(
        &self,
        command_index: usize,
        block_start: u64,
        block_end: u64,
    ) -> Option<usize> {
        self.processing_commands
            .get(command_index)
            .filter(|command| command.at_sample() < block_end)
            .map(|command| command.at_sample().saturating_sub(block_start) as usize)
    }

    fn next_scheduled_event_frame(&self, block_start: u64, block_end: u64) -> Option<usize> {
        if !self.playing {
            return None;
        }

        self.scheduled_events
            .entries
            .iter()
            .filter_map(|entry| entry.as_ref())
            .map(ScheduledEventEntry::effective_sample)
            .filter(|sample| *sample >= block_start && *sample < block_end)
            .min()
            .map(|sample| sample.saturating_sub(block_start) as usize)
    }

    fn render_diagnostic_signal(
        &mut self,
        output: &mut [f32],
        context: ProcessContext,
        block_start: u64,
        block_end: u64,
    ) {
        let channels = context.output_channels.max(1) as usize;
        let frame_count = context.frame_count as usize;
        let mut command_index = 0;

        for frame in 0..frame_count {
            let sample_position = block_start.saturating_add(frame as u64);

            command_index = self.apply_commands_until(command_index, block_start, sample_position);
            self.apply_scheduled_events_until(sample_position);

            if self.playing && self.diagnostic_signal.enabled && !self.diagnostic_signal.panic_muted
            {
                let sample = self
                    .diagnostic_signal
                    .oscillator
                    .next_sample(context.sample_rate);
                let frame_start = frame * channels;
                let frame_end = frame_start + channels;

                for output_sample in &mut output[frame_start..frame_end] {
                    *output_sample = sample;
                }
            }
        }

        self.apply_scheduled_events_until(block_end);

        self.retain_future_commands(command_index, block_end);
    }

    fn apply_commands_until(
        &mut self,
        mut command_index: usize,
        block_start: u64,
        sample_position: u64,
    ) -> usize {
        while command_index < self.processing_commands.len() {
            let command = self.processing_commands[command_index];
            let applied_sample = command.at_sample().max(block_start);

            if applied_sample > sample_position {
                break;
            }

            let late_by_samples = block_start.saturating_sub(command.at_sample());

            if late_by_samples > 0 {
                self.command_diagnostics.late = self.command_diagnostics.late.saturating_add(1);
            }

            self.apply_command(command, applied_sample, late_by_samples);
            command_index += 1;
        }

        command_index
    }

    fn apply_scheduled_events_until(&mut self, sample_position: u64) {
        if !self.playing {
            return;
        }

        while let Some(entry) = self.scheduled_events.take_due_before(sample_position) {
            self.apply_scheduled_event(entry.event);
            self.reschedule_looped_event(entry);
        }
    }

    fn apply_scheduled_event(&mut self, event: ScheduledEngineEvent) {
        if self.dispatch_event_to_execution_plan(event) {
            return;
        }

        match event {
            ScheduledEngineEvent::NoteOn { note, velocity, .. } => {
                self.scheduled_test_voice.note_on(note, velocity);
            }
            ScheduledEngineEvent::NoteOff { .. } => {
                self.scheduled_test_voice.note_off();
            }
        }
    }

    fn dispatch_event_to_execution_plan(&mut self, event: ScheduledEngineEvent) -> bool {
        if let Some(plan) = self.execution_plan.as_mut() {
            return plan.dispatch_event(event);
        }

        if let Some(plan) = self
            .crossfade
            .as_mut()
            .and_then(|crossfade| crossfade.new_plan.as_mut())
        {
            return plan.dispatch_event(event);
        }

        false
    }

    fn reschedule_looped_event(&mut self, mut entry: ScheduledEventEntry) {
        if !self.transport_loop.enabled
            || self.transport_loop.end_sample <= self.transport_loop.start_sample
        {
            return;
        }

        if entry.original_sample < self.transport_loop.start_sample
            || entry.original_sample >= self.transport_loop.end_sample
        {
            return;
        }

        let loop_length = self
            .transport_loop
            .end_sample
            .saturating_sub(self.transport_loop.start_sample);
        let next_iteration = entry.loop_iteration.saturating_add(1);
        let next_sample = entry
            .original_sample
            .saturating_add(loop_length.saturating_mul(next_iteration));

        entry.loop_iteration = next_iteration;
        entry.event = set_scheduled_event_sample(entry.event, next_sample);
        let _ = self.scheduled_events.insert_entry(entry);
    }

    fn retain_future_commands(&mut self, command_index: usize, block_end: u64) {
        for index in command_index..self.processing_commands.len() {
            let command = self.processing_commands[index];

            if command.at_sample() >= block_end {
                self.pending_commands.push(command);
            }
        }

        self.processing_commands.clear();
    }

    fn retain_all_processing_commands(&mut self) {
        for index in 0..self.processing_commands.len() {
            self.pending_commands.push(self.processing_commands[index]);
        }

        self.processing_commands.clear();
    }

    fn drain_command_queue(&mut self) {
        loop {
            let command = self
                .command_receiver
                .as_ref()
                .and_then(EngineCommandReceiver::pop);
            let Some(command) = command else {
                break;
            };

            self.command_diagnostics.received = self.command_diagnostics.received.saturating_add(1);

            if let Some(last_sample) = self.last_received_command_sample {
                if command.at_sample() < last_sample {
                    self.command_diagnostics.out_of_order =
                        self.command_diagnostics.out_of_order.saturating_add(1);
                    self.reject_command(command.id(), CommandRejection::OutOfOrder);
                    continue;
                }
            }

            self.last_received_command_sample = Some(command.at_sample());

            if self.pending_commands.len() >= PENDING_COMMAND_CAPACITY {
                self.reject_command(command.id(), CommandRejection::PendingQueueFull);
                continue;
            }

            self.pending_commands.push(command);
        }
    }

    fn apply_command(&mut self, command: EngineCommand, applied_sample: u64, late_by_samples: u64) {
        match command {
            EngineCommand::TransportStart { .. } => {
                self.playing = true;
                self.diagnostic_signal.panic_muted = false;
                self.publish_event(EngineEvent::TransportStateChanged {
                    playing: true,
                    at_sample: applied_sample,
                });
            }
            EngineCommand::TransportStop { .. } => {
                self.playing = false;
                self.scheduled_events.clear();
                self.scheduled_test_voice.note_off();
                if let Some(plan) = self.execution_plan.as_mut() {
                    plan.reset();
                }
                self.publish_event(EngineEvent::TransportStateChanged {
                    playing: false,
                    at_sample: applied_sample,
                });
            }
            EngineCommand::Panic { .. } => {
                self.playing = false;
                self.diagnostic_signal.panic_muted = true;
                self.diagnostic_signal.oscillator.reset();
                self.scheduled_events.clear();
                self.scheduled_test_voice.panic();
                if let Some(plan) = self.execution_plan.as_mut() {
                    plan.reset();
                }
                self.clear_crossfade_for_panic();
                self.publish_event(EngineEvent::TransportStateChanged {
                    playing: false,
                    at_sample: applied_sample,
                });
            }
            EngineCommand::SetParameter {
                parameter_id,
                value,
                ramp_samples,
                ..
            } => {
                if !self.set_parameter(parameter_id, value, ramp_samples) {
                    self.reject_command(command.id(), CommandRejection::UnknownParameter);
                    return;
                }

                self.last_parameter = Some((parameter_id, value));
            }
            EngineCommand::SetTempoMap { tempo, .. } => {
                self.tempo_map = tempo;
                self.scheduled_events.retime_beat_events_outside_horizon(
                    self.tempo_map,
                    applied_sample.saturating_add(COMMITTED_SCHEDULING_HORIZON_SAMPLES),
                );
            }
            EngineCommand::SetTransportLoop { transport_loop, .. } => {
                self.transport_loop = transport_loop;
            }
            EngineCommand::ScheduleEvent { event, .. } => {
                if !self.playing {
                    return;
                }

                if self.scheduled_events.insert(event, None).is_err() {
                    self.reject_command(command.id(), CommandRejection::SchedulerFull);
                    return;
                }
            }
            EngineCommand::ScheduleBeatEvent { event, .. } => {
                if !self.playing {
                    return;
                }

                let sample_event = event.to_sample_event(self.tempo_map);

                if self
                    .scheduled_events
                    .insert(sample_event, Some(event))
                    .is_err()
                {
                    self.reject_command(command.id(), CommandRejection::SchedulerFull);
                    return;
                }
            }
            EngineCommand::SwapExecutionPlan { id, .. } => {
                self.reject_swap_command(id, CommandRejection::MissingPreparedPlan);
                return;
            }
        }

        self.command_diagnostics.applied = self.command_diagnostics.applied.saturating_add(1);
        self.publish_event(EngineEvent::CommandApplied {
            command_id: command.id(),
            applied_sample,
            late_by_samples,
        });
    }

    fn set_parameter(&mut self, parameter_id: u32, value: f32, ramp_samples: u32) -> bool {
        if let Some(new_plan) = self
            .crossfade
            .as_mut()
            .and_then(|crossfade| crossfade.new_plan.as_mut())
        {
            return new_plan.set_parameter(parameter_id, value, ramp_samples);
        }

        if let Some(plan) = self.execution_plan.as_mut() {
            return plan.set_parameter(parameter_id, value, ramp_samples);
        }

        match parameter_id {
            PARAM_DIAGNOSTIC_FREQUENCY => {
                self.diagnostic_signal.oscillator.set_frequency(value);
                true
            }
            PARAM_DIAGNOSTIC_GAIN => {
                self.diagnostic_signal
                    .oscillator
                    .set_gain_target(value, ramp_samples);
                true
            }
            _ => false,
        }
    }

    fn clear_crossfade_for_panic(&mut self) {
        let Some(mut crossfade) = self.crossfade.take() else {
            return;
        };

        if let Some(old_plan) = crossfade.old_plan.take() {
            self.retire_or_defer(RetiredExecutionPlan {
                plan_id: old_plan.plan_id(),
                plan_revision: old_plan.plan_revision(),
                plan: old_plan,
            });
        }

        if let Some(new_plan) = crossfade.new_plan.take() {
            self.retire_or_defer(RetiredExecutionPlan {
                plan_id: new_plan.plan_id(),
                plan_revision: new_plan.plan_revision(),
                plan: new_plan,
            });
        }
    }

    fn reject_command(&mut self, command_id: u64, reason: CommandRejection) {
        self.command_diagnostics.rejected = self.command_diagnostics.rejected.saturating_add(1);
        self.publish_event(EngineEvent::CommandRejected { command_id, reason });
    }

    fn publish_event(&mut self, event: EngineEvent) {
        if let Some(sender) = &self.telemetry_sender {
            if sender.push(event).is_err() {
                self.command_diagnostics.telemetry_queue_overflows = sender.overflow_count();
            }
        }
    }

    fn current_command_diagnostics(&self) -> CommandDiagnostics {
        CommandDiagnostics {
            command_queue_overflows: self
                .command_receiver
                .as_ref()
                .map(EngineCommandReceiver::overflow_count)
                .unwrap_or(self.command_diagnostics.command_queue_overflows),
            telemetry_queue_overflows: self
                .telemetry_sender
                .as_ref()
                .map(EngineTelemetrySender::overflow_count)
                .unwrap_or(self.command_diagnostics.telemetry_queue_overflows),
            ..self.command_diagnostics
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PlanStateTransfer, StateTransferEntry, StateTransferKind};
    use engine_protocol::{
        diagnostic_tone_plan, monophonic_voice_plan, ScheduledBeatEvent, ScheduledEngineEvent,
        TempoMapSnapshot, TransportLoop, VoiceNodePlan, NODE_VOICE, PARAM_GAIN_GAIN,
    };

    fn plan_with_identity(
        plan_id: u64,
        plan_revision: u64,
        frequency_hz: f32,
    ) -> NativeExecutionPlan {
        plan_with_identity_and_gain(plan_id, plan_revision, frequency_hz, 0.05)
    }

    fn plan_with_identity_and_gain(
        plan_id: u64,
        plan_revision: u64,
        frequency_hz: f32,
        gain: f32,
    ) -> NativeExecutionPlan {
        let mut plan = diagnostic_tone_plan(frequency_hz, gain, 2);

        plan.plan_id = plan_id;
        plan.plan_revision = plan_revision;
        plan
    }

    fn matching_diagnostic_state_transfer() -> PlanStateTransfer {
        PlanStateTransfer {
            entries: vec![
                StateTransferEntry {
                    old_node_index: 0,
                    new_node_index: 0,
                    kind: StateTransferKind::OscillatorPhase,
                },
                StateTransferEntry {
                    old_node_index: 1,
                    new_node_index: 1,
                    kind: StateTransferKind::GainSmoother,
                },
            ]
            .into_boxed_slice(),
        }
    }

    fn prepared_transfer(
        transfer_id: u64,
        plan_id: u64,
        plan_revision: u64,
        frequency_hz: f32,
    ) -> crate::PreparedPlanTransfer {
        let plan = plan_with_identity(plan_id, plan_revision, frequency_hz);
        let prepared = PreparedExecutionPlan::prepare(&plan, 512).unwrap();

        crate::PreparedPlanTransfer::new(transfer_id, prepared, PlanStateTransfer::empty())
    }

    fn prepared_transfer_with_state(
        transfer_id: u64,
        plan_id: u64,
        plan_revision: u64,
        frequency_hz: f32,
        gain: f32,
        state_transfer: PlanStateTransfer,
    ) -> crate::PreparedPlanTransfer {
        let plan = plan_with_identity_and_gain(plan_id, plan_revision, frequency_hz, gain);
        let prepared = PreparedExecutionPlan::prepare(&plan, 512).unwrap();

        crate::PreparedPlanTransfer::new(transfer_id, prepared, state_transfer)
    }

    fn process_block(engine: &mut AudioEngine, output: &mut [f32], frames: u32) -> AudioTelemetry {
        engine.process(
            output,
            ProcessContext {
                block_start_sample: engine.sample_position(),
                frame_count: frames,
                sample_rate: 48_000.0,
                output_channels: 2,
            },
        )
    }

    fn process_frames(engine: &mut AudioEngine, frames: u32) -> Vec<f32> {
        let mut output = vec![0.0_f32; frames as usize * 2];

        process_block(engine, &mut output, frames);

        output
    }

    fn process_frames_telemetry(engine: &mut AudioEngine, frames: u32) -> AudioTelemetry {
        let mut output = vec![0.0_f32; frames as usize * 2];

        process_block(engine, &mut output, frames)
    }

    fn scheduled_note_on(at_sample: u64) -> ScheduledEngineEvent {
        ScheduledEngineEvent::NoteOn {
            target_node: NODE_VOICE,
            note: 69,
            velocity: 0.5,
            at_sample,
        }
    }

    fn scheduled_note_off(at_sample: u64) -> ScheduledEngineEvent {
        ScheduledEngineEvent::NoteOff {
            target_node: NODE_VOICE,
            note: 69,
            at_sample,
        }
    }

    fn voice_plan_with_adsr(
        attack_seconds: f32,
        decay_seconds: f32,
        sustain_level: f32,
        release_seconds: f32,
    ) -> NativeExecutionPlan {
        let mut plan = monophonic_voice_plan(2);

        if let engine_protocol::PlanNodeKind::Voice(node) = &mut plan.nodes[0].kind {
            *node = VoiceNodePlan {
                output_buffer: 1,
                attack_seconds,
                decay_seconds,
                sustain_level,
                release_seconds,
            };
        }

        plan
    }

    fn assert_outputs_close(left: &[f32], right: &[f32]) {
        assert_eq!(left.len(), right.len());

        for (left, right) in left.iter().zip(right.iter()) {
            assert!((left - right).abs() < 0.000_000_1);
        }
    }

    fn frame_is_silent(output: &[f32], frame: usize) -> bool {
        output[frame * 2] == 0.0 && output[frame * 2 + 1] == 0.0
    }

    fn frame_has_signal(output: &[f32], frame: usize) -> bool {
        output[frame * 2] != 0.0 || output[frame * 2 + 1] != 0.0
    }

    fn next_swap_event(receiver: &crate::EngineTelemetryReceiver) -> Option<EngineEvent> {
        while let Some(event) = receiver.pop() {
            if matches!(event, EngineEvent::ExecutionPlanSwapped { .. }) {
                return Some(event);
            }
        }

        None
    }

    fn next_rejection_event(receiver: &crate::EngineTelemetryReceiver) -> Option<EngineEvent> {
        while let Some(event) = receiver.pop() {
            if matches!(event, EngineEvent::CommandRejected { .. }) {
                return Some(event);
            }
        }

        None
    }

    fn enqueue_parity_commands(command_sender: &crate::EngineCommandSender) {
        command_sender
            .push(EngineCommand::SetParameter {
                id: 1,
                parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                value: 440.0,
                at_sample: 0,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 2,
                parameter_id: PARAM_DIAGNOSTIC_GAIN,
                value: 0.0,
                at_sample: 0,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::TransportStart {
                id: 3,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 4,
                parameter_id: PARAM_DIAGNOSTIC_GAIN,
                value: 0.2,
                at_sample: 32,
                ramp_samples: 48,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 5,
                parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                value: 660.0,
                at_sample: 100,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::Panic {
                id: 6,
                at_sample: 220,
            })
            .unwrap();
    }

    fn render_diagnostic_or_plan(use_plan: bool, groups: &[u32]) -> Vec<f32> {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new();

        if use_plan {
            let plan = diagnostic_tone_plan(440.0, 0.05, 2);

            engine = engine.with_execution_plan(&plan, 512).unwrap();
        } else {
            engine = engine.with_diagnostic_signal();
        }

        let mut engine = engine.with_realtime_queues(command_receiver, telemetry_sender);
        let mut rendered = Vec::new();

        enqueue_parity_commands(&command_sender);

        for frames in groups {
            rendered.extend(process_frames(&mut engine, *frames));
        }

        rendered
    }

    #[test]
    fn writes_silence_and_advances_sample_position() {
        let mut engine = AudioEngine::new();
        let mut output = [1.0_f32; 256];
        let telemetry = process_block(&mut engine, &mut output, 128);

        assert!(output.iter().all(|sample| *sample == 0.0));
        assert_eq!(engine.sample_position(), 128);
        assert_eq!(telemetry.sample_position, 128);
        assert_eq!(telemetry.callback_count, 1);
        assert_eq!(telemetry.sample_rate, 48_000);
        assert_eq!(telemetry.callback_frames, 128);
        assert_eq!(telemetry.output_channels, 2);
    }

    #[test]
    fn applies_timestamped_commands_for_current_block() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 128,
            })
            .unwrap();

        process_block(&mut engine, &mut output, 128);
        assert!(!engine.is_playing());

        process_block(&mut engine, &mut output, 128);
        assert!(engine.is_playing());
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::TransportStateChanged {
                playing: true,
                at_sample: 128
            })
        );
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandApplied {
                command_id: 1,
                applied_sample: 128,
                late_by_samples: 0
            })
        );
    }

    #[test]
    fn applies_commands_inside_a_block_at_their_sample() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        command_sender
            .push(EngineCommand::SetParameter {
                id: 2,
                parameter_id: PARAM_DIAGNOSTIC_GAIN,
                value: 0.5,
                at_sample: 44,
                ramp_samples: 8,
            })
            .unwrap();

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.last_parameter(), Some((PARAM_DIAGNOSTIC_GAIN, 0.5)));
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandApplied {
                command_id: 2,
                applied_sample: 44,
                late_by_samples: 0
            })
        );
    }

    #[test]
    fn retains_future_commands_without_applying_them() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        command_sender
            .push(EngineCommand::TransportStart {
                id: 3,
                at_sample: 256,
            })
            .unwrap();

        let telemetry = process_block(&mut engine, &mut output, 128);

        assert!(!engine.is_playing());
        assert_eq!(telemetry.pending_command_count, 1);
    }

    #[test]
    fn applies_late_commands_at_block_start_and_reports_lateness() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        process_block(&mut engine, &mut output, 128);

        command_sender
            .push(EngineCommand::SetParameter {
                id: 7,
                parameter_id: PARAM_DIAGNOSTIC_GAIN,
                value: 0.75,
                at_sample: 64,
                ramp_samples: 0,
            })
            .unwrap();

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.last_parameter(), Some((PARAM_DIAGNOSTIC_GAIN, 0.75)));
        assert_eq!(engine.command_diagnostics().late, 1);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandApplied {
                command_id: 7,
                applied_sample: 128,
                late_by_samples: 64
            })
        );
    }

    #[test]
    fn beat_events_convert_deterministically_at_fixed_tempo() {
        let tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 120.0,
            sample_rate: 48_000.0,
        };

        assert_eq!(tempo.beat_to_sample(0.0), 0);
        assert_eq!(tempo.beat_to_sample(1.0), 24_000);
        assert_eq!(tempo.beat_to_sample(2.5), 60_000);
    }

    #[test]
    fn tempo_change_affects_only_events_outside_committed_horizon() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_scheduled_test_voice()
            .with_realtime_queues(command_receiver, telemetry_sender);
        let initial_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 120.0,
            sample_rate: 48_000.0,
        };
        let slower_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 60.0,
            sample_rate: 48_000.0,
        };

        command_sender
            .push(EngineCommand::TransportStart {
                id: 0,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetTempoMap {
                id: 1,
                tempo: initial_tempo,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleBeatEvent {
                id: 2,
                event: ScheduledBeatEvent::NoteOn {
                    target_node: 1,
                    note: 69,
                    velocity: 0.5,
                    at_beat: 0.004,
                },
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleBeatEvent {
                id: 3,
                event: ScheduledBeatEvent::NoteOn {
                    target_node: 1,
                    note: 69,
                    velocity: 0.5,
                    at_beat: 1.0,
                },
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetTempoMap {
                id: 4,
                tempo: slower_tempo,
                at_sample: 0,
            })
            .unwrap();

        process_frames(&mut engine, 1);

        let samples = engine
            .scheduled_events
            .entries
            .iter()
            .filter_map(|entry| entry.as_ref())
            .map(ScheduledEventEntry::effective_sample)
            .collect::<Vec<_>>();

        assert!(samples.contains(&96));
        assert!(samples.contains(&48_000));
    }

    #[test]
    fn scheduled_events_inside_block_deliver_at_exact_offsets() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_scheduled_test_voice()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 2,
                event: scheduled_note_on(64),
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 3,
                event: scheduled_note_off(96),
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!(frame_is_silent(&output, 63));
        assert!(frame_has_signal(&output, 65));
        assert!(frame_is_silent(&output, 96));
    }

    #[test]
    fn voice_plan_note_on_begins_at_exact_scheduled_sample() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let plan = monophonic_voice_plan(2);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 2,
                event: scheduled_note_on(64),
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!(frame_is_silent(&output, 63));
        assert!(frame_has_signal(&output, 65));
    }

    #[test]
    fn voice_plan_note_off_enters_release_at_exact_sample() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let plan = voice_plan_with_adsr(0.0, 0.0, 1.0, 2.0 / 48_000.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 2,
                event: scheduled_note_on(0),
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 3,
                event: scheduled_note_off(64),
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!(frame_has_signal(&output, 63));
        assert!(frame_has_signal(&output, 64));
        assert!(frame_is_silent(&output, 66));
    }

    #[test]
    fn voice_plan_velocity_scales_output() {
        fn render_with_velocity(velocity: f32) -> Vec<f32> {
            let (command_sender, command_receiver) = crate::engine_command_queue();
            let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
            let plan = monophonic_voice_plan(2);
            let mut engine = AudioEngine::new()
                .with_execution_plan(&plan, 512)
                .unwrap()
                .with_realtime_queues(command_receiver, telemetry_sender);

            command_sender
                .push(EngineCommand::TransportStart {
                    id: 1,
                    at_sample: 0,
                })
                .unwrap();
            command_sender
                .push(EngineCommand::ScheduleEvent {
                    id: 2,
                    event: ScheduledEngineEvent::NoteOn {
                        target_node: NODE_VOICE,
                        note: 69,
                        velocity,
                        at_sample: 0,
                    },
                })
                .unwrap();

            process_frames(&mut engine, 128)
        }

        let quiet = render_with_velocity(0.25);
        let loud = render_with_velocity(1.0);
        let quiet_peak = quiet.iter().copied().map(f32::abs).fold(0.0, f32::max);
        let loud_peak = loud.iter().copied().map(f32::abs).fold(0.0, f32::max);

        assert!(loud_peak > quiet_peak * 3.5);
    }

    #[test]
    fn voice_plan_output_is_independent_of_callback_grouping() {
        fn render(groups: &[u32]) -> Vec<f32> {
            let (command_sender, command_receiver) = crate::engine_command_queue();
            let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
            let plan = voice_plan_with_adsr(4.0 / 48_000.0, 4.0 / 48_000.0, 0.5, 4.0 / 48_000.0);
            let mut engine = AudioEngine::new()
                .with_execution_plan(&plan, 512)
                .unwrap()
                .with_realtime_queues(command_receiver, telemetry_sender);
            let mut rendered = Vec::new();

            command_sender
                .push(EngineCommand::TransportStart {
                    id: 1,
                    at_sample: 0,
                })
                .unwrap();
            command_sender
                .push(EngineCommand::ScheduleEvent {
                    id: 2,
                    event: scheduled_note_on(32),
                })
                .unwrap();
            command_sender
                .push(EngineCommand::ScheduleEvent {
                    id: 3,
                    event: scheduled_note_off(160),
                })
                .unwrap();

            for frames in groups {
                rendered.extend(process_frames(&mut engine, *frames));
            }

            rendered
        }

        assert_outputs_close(&render(&[256]), &render(&[64, 32, 96, 64]));
    }

    #[test]
    fn voice_plan_tempo_retimes_note_pair_duration_in_beat_terms() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let plan = monophonic_voice_plan(2);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan, 4096)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender);
        let initial_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 120.0,
            sample_rate: 48_000.0,
        };
        let slower_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 60.0,
            sample_rate: 48_000.0,
        };

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetTempoMap {
                id: 2,
                tempo: initial_tempo,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleBeatEvent {
                id: 3,
                event: ScheduledBeatEvent::NoteOn {
                    target_node: NODE_VOICE,
                    note: 69,
                    velocity: 0.5,
                    at_beat: 1.0,
                },
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleBeatEvent {
                id: 4,
                event: ScheduledBeatEvent::NoteOff {
                    target_node: NODE_VOICE,
                    note: 69,
                    at_beat: 1.5,
                },
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetTempoMap {
                id: 5,
                tempo: slower_tempo,
                at_sample: 0,
            })
            .unwrap();

        process_frames(&mut engine, 1);

        let samples = engine
            .scheduled_events
            .entries
            .iter()
            .filter_map(|entry| entry.as_ref())
            .map(ScheduledEventEntry::effective_sample)
            .collect::<Vec<_>>();

        assert!(samples.contains(&48_000));
        assert!(samples.contains(&72_000));
    }

    #[test]
    fn loop_boundary_events_do_not_duplicate_or_disappear() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_scheduled_test_voice()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::SetTransportLoop {
                id: 1,
                transport_loop: TransportLoop {
                    enabled: true,
                    start_sample: 64,
                    end_sample: 96,
                },
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::TransportStart {
                id: 2,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 3,
                event: scheduled_note_on(64),
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 4,
                event: scheduled_note_off(80),
            })
            .unwrap();

        let output = process_frames(&mut engine, 160);

        assert!(frame_has_signal(&output, 65));
        assert!(frame_is_silent(&output, 80));
        assert!(frame_has_signal(&output, 97));
        assert!(frame_is_silent(&output, 112));
        assert!(frame_has_signal(&output, 129));
        assert!(frame_is_silent(&output, 144));
    }

    #[test]
    fn scheduled_event_timing_is_independent_of_callback_grouping() {
        fn render(groups: &[u32]) -> Vec<f32> {
            let (command_sender, command_receiver) = crate::engine_command_queue();
            let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
            let mut engine = AudioEngine::new()
                .with_scheduled_test_voice()
                .with_realtime_queues(command_receiver, telemetry_sender);
            let mut rendered = Vec::new();

            command_sender
                .push(EngineCommand::TransportStart {
                    id: 1,
                    at_sample: 0,
                })
                .unwrap();
            command_sender
                .push(EngineCommand::ScheduleEvent {
                    id: 2,
                    event: scheduled_note_on(64),
                })
                .unwrap();
            command_sender
                .push(EngineCommand::ScheduleEvent {
                    id: 3,
                    event: scheduled_note_off(160),
                })
                .unwrap();

            for frames in groups {
                rendered.extend(process_frames(&mut engine, *frames));
            }

            rendered
        }

        let a = render(&[256]);
        let b = render(&[32, 96, 16, 112]);

        assert_outputs_close(&a, &b);
    }

    #[test]
    fn late_scheduled_events_apply_at_next_block_start() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_scheduled_test_voice()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        process_frames(&mut engine, 128);
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 2,
                event: scheduled_note_on(64),
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!(frame_has_signal(&output, 1));
    }

    #[test]
    fn transport_stop_prevents_future_event_execution() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_scheduled_test_voice()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::TransportStop {
                id: 2,
                at_sample: 32,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 3,
                event: scheduled_note_on(64),
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!(output.iter().all(|sample| *sample == 0.0));
        assert!(engine.scheduled_events_empty());
    }

    #[test]
    fn panic_clears_scheduled_and_active_events() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_scheduled_test_voice()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 2,
                event: scheduled_note_on(16),
            })
            .unwrap();
        command_sender
            .push(EngineCommand::Panic {
                id: 3,
                at_sample: 64,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::ScheduleEvent {
                id: 4,
                event: scheduled_note_off(120),
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!(frame_has_signal(&output, 17));
        assert!(output[64 * 2..].iter().all(|sample| *sample == 0.0));
        assert!(engine.scheduled_events_empty());
    }

    #[test]
    fn rejects_out_of_order_commands() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 256,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::TransportStop {
                id: 2,
                at_sample: 128,
            })
            .unwrap();

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.command_diagnostics().out_of_order, 1);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandRejected {
                command_id: 2,
                reason: CommandRejection::OutOfOrder
            })
        );
    }

    #[test]
    fn applies_due_commands_in_deterministic_queue_order() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        for (id, value) in [(10, 0.1), (11, 0.2), (12, 0.3)] {
            command_sender
                .push(EngineCommand::SetParameter {
                    id,
                    parameter_id: PARAM_DIAGNOSTIC_GAIN,
                    value,
                    at_sample: 64,
                    ramp_samples: 0,
                })
                .unwrap();
        }

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.last_parameter(), Some((PARAM_DIAGNOSTIC_GAIN, 0.3)));
        for id in [10, 11, 12] {
            assert_eq!(
                telemetry_receiver.pop(),
                Some(EngineEvent::CommandApplied {
                    command_id: id,
                    applied_sample: 64,
                    late_by_samples: 0
                })
            );
        }
    }

    #[test]
    fn every_accepted_command_produces_an_acknowledgement() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        command_sender
            .push(EngineCommand::SetParameter {
                id: 20,
                parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                value: 0.25,
                at_sample: 0,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 21,
                parameter_id: PARAM_DIAGNOSTIC_GAIN,
                value: 0.5,
                at_sample: 32,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 22,
                parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                value: 0.75,
                at_sample: 96,
                ramp_samples: 0,
            })
            .unwrap();

        let telemetry = process_block(&mut engine, &mut output, 128);

        assert_eq!(telemetry.command_diagnostics.applied, 3);
        for id in [20, 21, 22] {
            assert!(matches!(
                telemetry_receiver.pop(),
                Some(EngineEvent::CommandApplied { command_id, .. }) if command_id == id
            ));
        }
    }

    #[test]
    fn panic_is_applied_under_heavy_command_traffic() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        command_sender
            .push(EngineCommand::TransportStart {
                id: 30,
                at_sample: 0,
            })
            .unwrap();
        for index in 0..100 {
            command_sender
                .push(EngineCommand::SetParameter {
                    id: 31 + index,
                    parameter_id: if index % 2 == 0 {
                        PARAM_DIAGNOSTIC_FREQUENCY
                    } else {
                        PARAM_DIAGNOSTIC_GAIN
                    },
                    value: index as f32,
                    at_sample: 64,
                    ramp_samples: 0,
                })
                .unwrap();
        }
        command_sender
            .push(EngineCommand::Panic {
                id: 400,
                at_sample: 96,
            })
            .unwrap();
        for index in 100..300 {
            command_sender
                .push(EngineCommand::SetParameter {
                    id: 31 + index,
                    parameter_id: if index % 2 == 0 {
                        PARAM_DIAGNOSTIC_FREQUENCY
                    } else {
                        PARAM_DIAGNOSTIC_GAIN
                    },
                    value: index as f32,
                    at_sample: 112,
                    ramp_samples: 0,
                })
                .unwrap();
        }

        process_block(&mut engine, &mut output, 128);

        assert!(!engine.is_playing());
        assert_eq!(engine.command_diagnostics().applied, 302);
        let mut saw_panic_ack = false;

        while let Some(event) = telemetry_receiver.pop() {
            saw_panic_ack |= matches!(
                event,
                EngineEvent::CommandApplied {
                    command_id: 400,
                    applied_sample: 96,
                    late_by_samples: 0
                }
            );
        }

        assert!(saw_panic_ack);
    }

    #[test]
    fn telemetry_overflow_does_not_prevent_audio_progress() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        for index in 0..300 {
            command_sender
                .push(EngineCommand::SetParameter {
                    id: index,
                    parameter_id: if index % 2 == 0 {
                        PARAM_DIAGNOSTIC_FREQUENCY
                    } else {
                        PARAM_DIAGNOSTIC_GAIN
                    },
                    value: index as f32,
                    at_sample: 0,
                    ramp_samples: 0,
                })
                .unwrap();
        }

        let telemetry = process_block(&mut engine, &mut output, 128);

        assert_eq!(telemetry.sample_position, 128);
        assert_eq!(telemetry.command_diagnostics.applied, 300);
        assert!(telemetry.command_diagnostics.telemetry_queue_overflows > 0);
    }

    #[test]
    fn sample_counter_is_monotonic() {
        let mut engine = AudioEngine::new();
        let mut output = [0.0_f32; 256];

        for expected in [128, 256, 384, 512] {
            let telemetry = process_block(&mut engine, &mut output, 128);

            assert_eq!(engine.sample_position(), expected);
            assert_eq!(telemetry.sample_position, expected);
        }
    }

    #[test]
    fn rejects_unknown_parameter_ids() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine =
            AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = [0.0_f32; 256];

        command_sender
            .push(EngineCommand::SetParameter {
                id: 500,
                parameter_id: 999,
                value: 1.0,
                at_sample: 0,
                ramp_samples: 0,
            })
            .unwrap();

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.command_diagnostics().rejected, 1);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandRejected {
                command_id: 500,
                reason: CommandRejection::UnknownParameter
            })
        );
    }

    #[test]
    fn diagnostic_signal_is_silent_while_stopped() {
        let mut engine = AudioEngine::new().with_diagnostic_signal();
        let output = process_frames(&mut engine, 512);

        assert!(output.iter().all(|sample| *sample == 0.0));
    }

    #[test]
    fn diagnostic_signal_starts_at_requested_sample_and_routes_stereo() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_diagnostic_signal()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 600,
                at_sample: 128,
            })
            .unwrap();

        let first = process_frames(&mut engine, 128);
        let second = process_frames(&mut engine, 128);

        assert!(first.iter().all(|sample| *sample == 0.0));
        assert!((1..128).any(|frame| frame_has_signal(&second, frame)));

        for frame in 0..128 {
            assert_eq!(second[frame * 2], second[frame * 2 + 1]);
        }
    }

    #[test]
    fn diagnostic_gain_change_applies_at_exact_sample() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_diagnostic_signal()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::SetParameter {
                id: 700,
                parameter_id: PARAM_DIAGNOSTIC_GAIN,
                value: 0.0,
                at_sample: 0,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::TransportStart {
                id: 701,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 702,
                parameter_id: PARAM_DIAGNOSTIC_GAIN,
                value: 1.0,
                at_sample: 100,
                ramp_samples: 0,
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!((0..100).all(|frame| frame_is_silent(&output, frame)));
        assert!((101..128).any(|frame| frame_has_signal(&output, frame)));
    }

    #[test]
    fn diagnostic_frequency_change_applies_inside_block() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_diagnostic_signal()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::SetParameter {
                id: 800,
                parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                value: 10.0,
                at_sample: 0,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::TransportStart {
                id: 801,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 802,
                parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                value: 20.0,
                at_sample: 50,
                ramp_samples: 0,
            })
            .unwrap();

        let mut output = vec![0.0_f32; 200];
        engine.process(
            &mut output,
            ProcessContext {
                block_start_sample: 0,
                frame_count: 100,
                sample_rate: 1_000.0,
                output_channels: 2,
            },
        );

        assert!((engine.diagnostic_phase() - 0.5).abs() < 0.000_000_1);
    }

    #[test]
    fn diagnostic_panic_silences_from_scheduled_sample() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let mut engine = AudioEngine::new()
            .with_diagnostic_signal()
            .with_realtime_queues(command_receiver, telemetry_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 900,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::Panic {
                id: 901,
                at_sample: 64,
            })
            .unwrap();

        let output = process_frames(&mut engine, 128);

        assert!((1..64).any(|frame| frame_has_signal(&output, frame)));
        assert!((64..128).all(|frame| frame_is_silent(&output, frame)));
    }

    #[test]
    fn diagnostic_output_is_independent_of_callback_grouping() {
        fn render_with_groups(groups: &[u32]) -> Vec<f32> {
            let (command_sender, command_receiver) = crate::engine_command_queue();
            let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
            let mut engine = AudioEngine::new()
                .with_diagnostic_signal()
                .with_realtime_queues(command_receiver, telemetry_sender);
            let mut rendered = Vec::new();

            command_sender
                .push(EngineCommand::SetParameter {
                    id: 1,
                    parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                    value: 220.0,
                    at_sample: 0,
                    ramp_samples: 0,
                })
                .unwrap();
            command_sender
                .push(EngineCommand::SetParameter {
                    id: 2,
                    parameter_id: PARAM_DIAGNOSTIC_GAIN,
                    value: 0.2,
                    at_sample: 0,
                    ramp_samples: 0,
                })
                .unwrap();
            command_sender
                .push(EngineCommand::TransportStart {
                    id: 3,
                    at_sample: 0,
                })
                .unwrap();
            command_sender
                .push(EngineCommand::SetParameter {
                    id: 4,
                    parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
                    value: 330.0,
                    at_sample: 192,
                    ramp_samples: 0,
                })
                .unwrap();

            for frames in groups {
                rendered.extend(process_frames(&mut engine, *frames));
            }

            rendered
        }

        let a = render_with_groups(&[128, 128, 128, 128]);
        let b = render_with_groups(&[64, 192, 32, 224]);

        assert_eq!(a.len(), b.len());
        for (left, right) in a.iter().zip(b.iter()) {
            assert!((left - right).abs() < 0.000_000_1);
        }
    }

    #[test]
    fn plan_driven_output_matches_diagnostic_signal_path() {
        let diagnostic = render_diagnostic_or_plan(false, &[64, 192, 32, 224]);
        let plan = render_diagnostic_or_plan(true, &[64, 192, 32, 224]);

        assert_eq!(diagnostic.len(), plan.len());
        for (diagnostic_sample, plan_sample) in diagnostic.iter().zip(plan.iter()) {
            assert!((diagnostic_sample - plan_sample).abs() < 0.000_000_1);
        }
    }

    #[test]
    fn plan_driven_output_is_independent_of_callback_grouping() {
        let a = render_diagnostic_or_plan(true, &[128, 128, 128, 128]);
        let b = render_diagnostic_or_plan(true, &[64, 192, 32, 224]);

        assert_eq!(a.len(), b.len());
        for (left, right) in a.iter().zip(b.iter()) {
            assert!((left - right).abs() < 0.000_000_1);
        }
    }

    #[test]
    fn plan_callback_over_capacity_outputs_silence_and_retains_commands() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let plan = diagnostic_tone_plan(440.0, 0.05, 2);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan, 64)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender);
        let mut output = vec![1.0_f32; 128 * 2];

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1000,
                at_sample: 0,
            })
            .unwrap();

        let telemetry = process_block(&mut engine, &mut output, 128);

        assert!(output.iter().all(|sample| *sample == 0.0));
        assert_eq!(telemetry.stream_errors, 1);
        assert_eq!(telemetry.pending_command_count, 1);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::StreamError { code: 1 })
        );
    }

    #[test]
    fn execution_plan_swap_applies_at_next_block_boundary() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        assert!(prepared_sender
            .push(prepared_transfer(10, 2, 1, 440.0))
            .is_ok());
        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 2,
                transfer_id: 10,
                requested_sample: 100,
            })
            .unwrap();

        let first = process_frames(&mut engine, 128);
        let telemetry = process_block(&mut engine, &mut vec![0.0; 256], 128);

        assert!(first.iter().any(|sample| *sample != 0.0));
        assert_eq!(telemetry.runtime_plan_status.active_plan_id, Some(2));
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 1);
        assert_eq!(
            next_swap_event(&telemetry_receiver),
            Some(EngineEvent::ExecutionPlanSwapped {
                command_id: 2,
                plan_id: 2,
                plan_revision: 1,
                requested_sample: 100,
                applied_sample: 128
            })
        );
    }

    #[test]
    fn execution_plan_swap_at_exact_boundary_applies_at_that_boundary() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, _retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        assert!(prepared_sender
            .push(prepared_transfer(11, 2, 3, 440.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 3,
                transfer_id: 11,
                requested_sample: 128,
            })
            .unwrap();

        process_frames(&mut engine, 128);
        process_frames(&mut engine, 128);

        assert_eq!(
            next_swap_event(&telemetry_receiver),
            Some(EngineEvent::ExecutionPlanSwapped {
                command_id: 3,
                plan_id: 2,
                plan_revision: 3,
                requested_sample: 128,
                applied_sample: 128
            })
        );
    }

    #[test]
    fn state_transfer_preserves_oscillator_phase_across_plan_swap() {
        fn render(swapped: bool) -> Vec<f32> {
            let (command_sender, command_receiver) = crate::engine_command_queue();
            let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
            let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
            let (retired_sender, _retired_receiver) = crate::retired_plan_queue();
            let plan_a = plan_with_identity(1, 1, 220.0);
            let mut engine = AudioEngine::new()
                .with_execution_plan(&plan_a, 512)
                .unwrap()
                .with_realtime_queues(command_receiver, telemetry_sender)
                .with_plan_transfer_queues(prepared_receiver, retired_sender);
            let mut rendered = Vec::new();

            command_sender
                .push(EngineCommand::TransportStart {
                    id: 1,
                    at_sample: 0,
                })
                .unwrap();

            if swapped {
                assert!(prepared_sender
                    .push(prepared_transfer_with_state(
                        30,
                        2,
                        1,
                        220.0,
                        0.05,
                        matching_diagnostic_state_transfer(),
                    ))
                    .is_ok());
                command_sender
                    .push(EngineCommand::SwapExecutionPlan {
                        id: 2,
                        transfer_id: 30,
                        requested_sample: 128,
                    })
                    .unwrap();
            }

            rendered.extend(process_frames(&mut engine, 128));
            rendered.extend(process_frames(&mut engine, 128));
            rendered
        }

        let uninterrupted = render(false);
        let swapped = render(true);

        assert_eq!(uninterrupted.len(), swapped.len());
        for (left, right) in uninterrupted.iter().zip(swapped.iter()) {
            assert!((left - right).abs() < 0.000_000_1);
        }
    }

    #[test]
    fn state_transfer_preserves_gain_ramp_across_plan_swap() {
        fn render(swapped: bool) -> Vec<f32> {
            let (command_sender, command_receiver) = crate::engine_command_queue();
            let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
            let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
            let (retired_sender, _retired_receiver) = crate::retired_plan_queue();
            let plan_a = plan_with_identity_and_gain(1, 1, 330.0, 0.0);
            let mut engine = AudioEngine::new()
                .with_execution_plan(&plan_a, 512)
                .unwrap()
                .with_realtime_queues(command_receiver, telemetry_sender)
                .with_plan_transfer_queues(prepared_receiver, retired_sender);
            let mut rendered = Vec::new();

            command_sender
                .push(EngineCommand::TransportStart {
                    id: 1,
                    at_sample: 0,
                })
                .unwrap();
            command_sender
                .push(EngineCommand::SetParameter {
                    id: 2,
                    parameter_id: PARAM_GAIN_GAIN,
                    value: 1.0,
                    at_sample: 0,
                    ramp_samples: 256,
                })
                .unwrap();

            if swapped {
                assert!(prepared_sender
                    .push(prepared_transfer_with_state(
                        31,
                        2,
                        1,
                        330.0,
                        0.0,
                        matching_diagnostic_state_transfer(),
                    ))
                    .is_ok());
                command_sender
                    .push(EngineCommand::SwapExecutionPlan {
                        id: 3,
                        transfer_id: 31,
                        requested_sample: 128,
                    })
                    .unwrap();
            }

            rendered.extend(process_frames(&mut engine, 128));
            rendered.extend(process_frames(&mut engine, 128));
            rendered
        }

        let uninterrupted = render(false);
        let swapped = render(true);

        assert_eq!(uninterrupted.len(), swapped.len());
        for (left, right) in uninterrupted.iter().zip(swapped.iter()) {
            assert!((left - right).abs() < 0.000_000_1);
        }
    }

    #[test]
    fn unmatched_nodes_start_fresh_when_no_state_transfer_is_supplied() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, _retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        assert!(prepared_sender
            .push(prepared_transfer(32, 2, 1, 220.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 2,
                transfer_id: 32,
                requested_sample: 128,
            })
            .unwrap();

        let first = process_frames(&mut engine, 128);
        let second = process_frames(&mut engine, 128);

        assert!(first[128] != 0.0);
        assert!(second[0] != 0.0);
        assert!((first[254] - second[0]).abs() < 0.005);
    }

    #[test]
    fn crossfade_masks_unmatched_oscillator_swap_discontinuity() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, _retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        assert!(prepared_sender
            .push(prepared_transfer(34, 2, 1, 440.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 2,
                transfer_id: 34,
                requested_sample: 128,
            })
            .unwrap();

        let first = process_frames(&mut engine, 128);
        let second = process_frames(&mut engine, 128);

        assert!((first[254] - second[0]).abs() < 0.005);
    }

    #[test]
    fn crossfade_retires_old_plan_only_after_exact_duration() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        assert!(prepared_sender
            .push(prepared_transfer(35, 2, 1, 330.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 2,
                transfer_id: 35,
                requested_sample: 128,
            })
            .unwrap();

        process_frames(&mut engine, 128);
        process_frames(&mut engine, 64);
        assert!(retired_receiver.pop().is_none());

        process_frames(&mut engine, 64);
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 1);
        assert!(retired_receiver.pop().is_none());
    }

    #[test]
    fn crossfade_output_is_independent_of_callback_grouping() {
        fn render(groups: &[u32]) -> Vec<f32> {
            let (command_sender, command_receiver) = crate::engine_command_queue();
            let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
            let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
            let (retired_sender, _retired_receiver) = crate::retired_plan_queue();
            let plan_a = plan_with_identity(1, 1, 220.0);
            let mut engine = AudioEngine::new()
                .with_execution_plan(&plan_a, 512)
                .unwrap()
                .with_realtime_queues(command_receiver, telemetry_sender)
                .with_plan_transfer_queues(prepared_receiver, retired_sender);
            let mut rendered = Vec::new();

            command_sender
                .push(EngineCommand::TransportStart {
                    id: 1,
                    at_sample: 0,
                })
                .unwrap();
            assert!(prepared_sender
                .push(prepared_transfer(36, 2, 1, 440.0))
                .is_ok());
            command_sender
                .push(EngineCommand::SwapExecutionPlan {
                    id: 2,
                    transfer_id: 36,
                    requested_sample: 128,
                })
                .unwrap();

            for frames in groups {
                rendered.extend(process_frames(&mut engine, *frames));
            }

            rendered
        }

        let grouped_a = render(&[128, 128, 128]);
        let grouped_b = render(&[64, 64, 32, 96, 128]);

        assert_outputs_close(&grouped_a, &grouped_b);
    }

    #[test]
    fn second_swap_during_crossfade_is_rejected() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        assert!(prepared_sender
            .push(prepared_transfer(37, 2, 1, 330.0))
            .is_ok());
        assert!(prepared_sender
            .push(prepared_transfer(38, 3, 1, 440.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 2,
                transfer_id: 37,
                requested_sample: 128,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 3,
                transfer_id: 38,
                requested_sample: 160,
            })
            .unwrap();

        process_frames(&mut engine, 128);
        process_frames(&mut engine, 64);
        let telemetry = process_frames_telemetry(&mut engine, 64);

        assert_eq!(telemetry.runtime_plan_status.active_plan_id, Some(2));
        assert_eq!(telemetry.runtime_plan_status.rejected_swaps, 1);
        assert_eq!(
            next_swap_event(&telemetry_receiver),
            Some(EngineEvent::ExecutionPlanSwapped {
                command_id: 2,
                plan_id: 2,
                plan_revision: 1,
                requested_sample: 128,
                applied_sample: 128
            })
        );
        assert_eq!(
            next_rejection_event(&telemetry_receiver),
            Some(EngineEvent::CommandRejected {
                command_id: 3,
                reason: CommandRejection::SwapInProgress
            })
        );
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 3);
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 1);
    }

    #[test]
    fn panic_during_crossfade_outputs_immediate_silence() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        command_sender
            .push(EngineCommand::TransportStart {
                id: 1,
                at_sample: 0,
            })
            .unwrap();
        assert!(prepared_sender
            .push(prepared_transfer(39, 2, 1, 330.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 2,
                transfer_id: 39,
                requested_sample: 128,
            })
            .unwrap();

        process_frames(&mut engine, 128);
        command_sender
            .push(EngineCommand::Panic {
                id: 3,
                at_sample: 128,
            })
            .unwrap();
        let second = process_frames(&mut engine, 128);

        assert!(second.iter().all(|sample| *sample == 0.0));
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 1);
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 2);
    }

    #[test]
    fn invalid_state_transfer_rejects_swap_without_changing_active_plan() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);
        let invalid_transfer = PlanStateTransfer {
            entries: vec![StateTransferEntry {
                old_node_index: 0,
                new_node_index: 0,
                kind: StateTransferKind::GainSmoother,
            }]
            .into_boxed_slice(),
        };

        assert!(prepared_sender
            .push(prepared_transfer_with_state(
                33,
                2,
                1,
                220.0,
                0.05,
                invalid_transfer,
            ))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 8,
                transfer_id: 33,
                requested_sample: 0,
            })
            .unwrap();

        let telemetry = process_frames_telemetry(&mut engine, 128);

        assert_eq!(telemetry.runtime_plan_status.active_plan_id, Some(1));
        assert_eq!(telemetry.runtime_plan_status.rejected_swaps, 1);
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 2);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandRejected {
                command_id: 8,
                reason: CommandRejection::InvalidStateTransfer
            })
        );
    }

    #[test]
    fn missing_execution_plan_transfer_rejects_without_changing_active_plan() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let (_prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, _retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 4,
                transfer_id: 404,
                requested_sample: 0,
            })
            .unwrap();

        let telemetry = process_frames_telemetry(&mut engine, 128);

        assert_eq!(telemetry.runtime_plan_status.active_plan_id, Some(1));
        assert_eq!(telemetry.runtime_plan_status.rejected_swaps, 1);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandRejected {
                command_id: 4,
                reason: CommandRejection::MissingPreparedPlan
            })
        );
    }

    #[test]
    fn duplicate_execution_plan_transfer_id_is_rejected() {
        let (_command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = crate::retired_plan_queue();
        let mut engine = AudioEngine::new()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        assert!(prepared_sender
            .push(prepared_transfer(77, 1, 1, 220.0))
            .is_ok());
        assert!(prepared_sender
            .push(prepared_transfer(77, 2, 1, 440.0))
            .is_ok());

        let telemetry = process_frames_telemetry(&mut engine, 128);

        assert_eq!(telemetry.runtime_plan_status.pending_plan_count, 1);
        assert_eq!(telemetry.runtime_plan_status.rejected_swaps, 1);
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 2);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandRejected {
                command_id: 77,
                reason: CommandRejection::DuplicatePreparedPlan
            })
        );
    }

    #[test]
    fn full_retirement_queue_rejects_swap_and_preserves_active_plan() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, _retired_receiver) = crate::retired_plan_queue();

        for index in 0..3 {
            assert!(retired_sender
                .push(crate::RetiredExecutionPlan {
                    plan_id: 100 + index,
                    plan_revision: 1,
                    plan: PreparedExecutionPlan::prepare(
                        &plan_with_identity(100 + index, 1, 110.0 + index as f32),
                        512,
                    )
                    .unwrap(),
                })
                .is_ok());
        }

        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        assert!(prepared_sender
            .push(prepared_transfer(12, 2, 1, 440.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 5,
                transfer_id: 12,
                requested_sample: 0,
            })
            .unwrap();

        let telemetry = process_frames_telemetry(&mut engine, 128);

        assert_eq!(telemetry.runtime_plan_status.active_plan_id, Some(1));
        assert_eq!(telemetry.runtime_plan_status.pending_plan_count, 1);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandRejected {
                command_id: 5,
                reason: CommandRejection::RetirementQueueFull
            })
        );
    }

    #[test]
    fn multiple_execution_plan_swaps_retire_in_order() {
        let (command_sender, command_receiver) = crate::engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = crate::engine_telemetry_queue();
        let (prepared_sender, prepared_receiver) = crate::prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = crate::retired_plan_queue();
        let plan_a = plan_with_identity(1, 1, 220.0);
        let mut engine = AudioEngine::new()
            .with_execution_plan(&plan_a, 512)
            .unwrap()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);

        assert!(prepared_sender
            .push(prepared_transfer(20, 2, 1, 330.0))
            .is_ok());
        assert!(prepared_sender
            .push(prepared_transfer(21, 3, 1, 440.0))
            .is_ok());
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 6,
                transfer_id: 20,
                requested_sample: 128,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SwapExecutionPlan {
                id: 7,
                transfer_id: 21,
                requested_sample: 256,
            })
            .unwrap();

        process_frames(&mut engine, 128);
        process_frames(&mut engine, 128);
        let telemetry = process_frames_telemetry(&mut engine, 128);

        assert_eq!(telemetry.runtime_plan_status.active_plan_id, Some(3));
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 1);
        assert_eq!(retired_receiver.pop().unwrap().plan_id, 2);
    }
}
