use std::time::Instant;

use engine_dsp::{DiagnosticOscillator, PARAM_DIAGNOSTIC_FREQUENCY, PARAM_DIAGNOSTIC_GAIN};
use engine_protocol::{
    AudioTelemetry, CommandDiagnostics, CommandRejection, EngineCommand, EngineEvent,
    NativeExecutionPlan, RuntimePlanStatus,
};

use crate::{
    EngineCommandReceiver, EngineTelemetrySender, PendingPlanSet, PlanValidationError,
    PreparedExecutionPlan, PreparedPlanReceiver, ProcessContext, ProcessRange,
    RetiredExecutionPlan, RetiredPlanSender,
};

const PENDING_COMMAND_CAPACITY: usize = 1024;

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

pub struct AudioEngine {
    sample_position: u64,
    callback_count: u64,
    maximum_callback_duration_ns: u64,
    stream_errors: u64,
    probable_xruns: u64,
    playing: bool,
    last_parameter: Option<(u32, f32)>,
    diagnostic_signal: DiagnosticSignalState,
    execution_plan: Option<PreparedExecutionPlan>,
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
            execution_plan: None,
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

    pub fn with_execution_plan(
        mut self,
        plan: &NativeExecutionPlan,
        maximum_frames: usize,
    ) -> Result<Self, PlanValidationError> {
        self.execution_plan = Some(PreparedExecutionPlan::prepare(plan, maximum_frames)?);
        Ok(self)
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

    pub fn process(&mut self, output: &mut [f32], context: ProcessContext) -> AudioTelemetry {
        let started_at = Instant::now();

        let block_start = self.sample_position;
        let block_end = block_start.saturating_add(context.frame_count as u64);

        self.drain_command_queue();
        self.prepare_block_commands();
        self.drain_plan_transfers();
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
                .map(PreparedExecutionPlan::plan_id),
            active_plan_revision: self
                .execution_plan
                .as_ref()
                .map(PreparedExecutionPlan::plan_revision),
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
        if let Some(sender) = self.retired_plan_sender.as_ref() {
            let _ = sender.push(RetiredExecutionPlan {
                plan_id: transfer.plan_id,
                plan_revision: transfer.plan_revision,
                plan: transfer.plan,
            });
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
        let Some(transfer) = self.pending_plans.take(transfer_id) else {
            self.reject_swap_command(id, CommandRejection::MissingPreparedPlan);
            return;
        };

        if let Some(old_plan) = self.execution_plan.take() {
            let retired = RetiredExecutionPlan {
                plan_id: old_plan.plan_id(),
                plan_revision: old_plan.plan_revision(),
                plan: old_plan,
            };

            let Some(sender) = self.retired_plan_sender.as_ref() else {
                let _ = self.pending_plans.insert(transfer);
                self.execution_plan = Some(retired.plan);
                self.reject_swap_command(id, CommandRejection::RetirementQueueFull);
                return;
            };

            if let Err(retired) = sender.push(retired) {
                let _ = self.pending_plans.insert(transfer);
                self.execution_plan = Some(retired.plan);
                self.reject_swap_command(id, CommandRejection::RetirementQueueFull);
                return;
            }
        }

        let plan_id = transfer.plan_id;
        let plan_revision = transfer.plan_revision;

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

        if self.execution_plan.is_some() {
            self.render_execution_plan(output, context, block_start, block_end);
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

        if self
            .execution_plan
            .as_ref()
            .map(|plan| frame_count > plan.maximum_frames())
            .unwrap_or(false)
        {
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

            if current_frame < next_frame && self.playing {
                let range = ProcessRange {
                    start_frame: current_frame,
                    end_frame: next_frame,
                };
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

            current_frame = next_frame;
        }

        self.retain_future_commands(command_index, block_end);
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
                self.publish_event(EngineEvent::TransportStateChanged {
                    playing: false,
                    at_sample: applied_sample,
                });
            }
            EngineCommand::Panic { .. } => {
                self.playing = false;
                self.diagnostic_signal.panic_muted = true;
                self.diagnostic_signal.oscillator.reset();
                if let Some(plan) = self.execution_plan.as_mut() {
                    plan.reset();
                }
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
    use engine_protocol::diagnostic_tone_plan;

    fn plan_with_identity(
        plan_id: u64,
        plan_revision: u64,
        frequency_hz: f32,
    ) -> NativeExecutionPlan {
        let mut plan = diagnostic_tone_plan(frequency_hz, 0.05, 2);

        plan.plan_id = plan_id;
        plan.plan_revision = plan_revision;
        plan
    }

    fn prepared_transfer(
        transfer_id: u64,
        plan_id: u64,
        plan_revision: u64,
        frequency_hz: f32,
    ) -> crate::PreparedPlanTransfer {
        let plan = plan_with_identity(plan_id, plan_revision, frequency_hz);
        let prepared = PreparedExecutionPlan::prepare(&plan, 512).unwrap();

        crate::PreparedPlanTransfer {
            transfer_id,
            plan_id,
            plan_revision,
            plan: prepared,
        }
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
