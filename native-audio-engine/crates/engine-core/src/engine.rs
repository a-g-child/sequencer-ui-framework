use std::time::Instant;

use engine_protocol::{
    AudioTelemetry, CommandDiagnostics, CommandRejection, EngineCommand, EngineEvent,
};

use crate::{EngineCommandReceiver, EngineTelemetrySender, ProcessContext};

const PENDING_COMMAND_CAPACITY: usize = 1024;

pub struct AudioEngine {
    sample_position: u64,
    callback_count: u64,
    maximum_callback_duration_ns: u64,
    stream_errors: u64,
    probable_xruns: u64,
    playing: bool,
    last_parameter: Option<(u32, f32)>,
    command_diagnostics: CommandDiagnostics,
    pending_commands: Vec<EngineCommand>,
    processing_commands: Vec<EngineCommand>,
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
            command_diagnostics: CommandDiagnostics::default(),
            pending_commands: Vec::with_capacity(PENDING_COMMAND_CAPACITY),
            processing_commands: Vec::with_capacity(PENDING_COMMAND_CAPACITY),
            command_receiver: None,
            telemetry_sender: None,
            last_received_command_sample: None,
        }
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

    pub fn sample_position(&self) -> u64 {
        self.sample_position
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn last_parameter(&self) -> Option<(u32, f32)> {
        self.last_parameter
    }

    pub fn command_diagnostics(&self) -> CommandDiagnostics {
        self.command_diagnostics
    }

    pub fn process(&mut self, output: &mut [f32], context: ProcessContext) -> AudioTelemetry {
        let started_at = Instant::now();

        output.fill(0.0);

        let block_start = self.sample_position;
        let block_end = block_start.saturating_add(context.frame_count as u64);

        self.drain_command_queue();
        self.apply_due_commands(block_start, block_end);

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
        }
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

    fn apply_due_commands(&mut self, block_start: u64, block_end: u64) {
        self.processing_commands.clear();
        std::mem::swap(&mut self.pending_commands, &mut self.processing_commands);

        for index in 0..self.processing_commands.len() {
            let command = self.processing_commands[index];
            if command.at_sample() >= block_end {
                self.pending_commands.push(command);
                continue;
            }

            let late_by_samples = block_start.saturating_sub(command.at_sample());
            let applied_sample = command.at_sample().max(block_start);

            if late_by_samples > 0 {
                self.command_diagnostics.late = self.command_diagnostics.late.saturating_add(1);
            }

            self.apply_command(command, applied_sample, late_by_samples);
        }

        self.processing_commands.clear();
    }

    fn apply_command(&mut self, command: EngineCommand, applied_sample: u64, late_by_samples: u64) {
        match command {
            EngineCommand::TransportStart { .. } => {
                self.playing = true;
                self.publish_event(EngineEvent::TransportStateChanged {
                    playing: true,
                    at_sample: applied_sample,
                });
            }
            EngineCommand::TransportStop { .. } | EngineCommand::Panic { .. } => {
                self.playing = false;
                self.publish_event(EngineEvent::TransportStateChanged {
                    playing: false,
                    at_sample: applied_sample,
                });
            }
            EngineCommand::SetParameter {
                parameter_id,
                value,
                ..
            } => {
                self.last_parameter = Some((parameter_id, value));
            }
        }

        self.command_diagnostics.applied = self.command_diagnostics.applied.saturating_add(1);
        self.publish_event(EngineEvent::CommandApplied {
            command_id: command.id(),
            applied_sample,
            late_by_samples,
        });
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
                parameter_id: 9,
                value: 0.5,
                at_sample: 44,
                ramp_samples: 8,
            })
            .unwrap();

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.last_parameter(), Some((9, 0.5)));
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
                parameter_id: 4,
                value: 0.75,
                at_sample: 64,
                ramp_samples: 0,
            })
            .unwrap();

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.last_parameter(), Some((4, 0.75)));
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
                    parameter_id: 5,
                    value,
                    at_sample: 64,
                    ramp_samples: 0,
                })
                .unwrap();
        }

        process_block(&mut engine, &mut output, 128);

        assert_eq!(engine.last_parameter(), Some((5, 0.3)));
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
                parameter_id: 1,
                value: 0.25,
                at_sample: 0,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 21,
                parameter_id: 2,
                value: 0.5,
                at_sample: 32,
                ramp_samples: 0,
            })
            .unwrap();
        command_sender
            .push(EngineCommand::SetParameter {
                id: 22,
                parameter_id: 3,
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
                    parameter_id: index as u32,
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
                    parameter_id: index as u32,
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
                    parameter_id: index as u32,
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
}
