use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use engine_protocol::{
    AudioTelemetry, CommandDiagnostics, EventGraphDiagnostics, RuntimePlanStatus,
};

#[derive(Debug, Default)]
pub struct RealtimeSnapshotAtomics {
    sample_position: AtomicU64,
    callback_count: AtomicU64,
    sample_rate: AtomicU32,
    callback_frames: AtomicU32,
    output_channels: AtomicU32,
    stream_errors: AtomicU64,
    probable_xruns: AtomicU64,
    command_queue_depth: AtomicU32,
    pending_command_count: AtomicU32,
    next_pending_command_sample: AtomicU64,
    command_received: AtomicU64,
    command_applied: AtomicU64,
    command_late: AtomicU64,
    command_rejected: AtomicU64,
    command_out_of_order: AtomicU64,
    command_queue_overflows: AtomicU64,
    telemetry_queue_overflows: AtomicU64,
}

impl RealtimeSnapshotAtomics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn publish(&self, telemetry: AudioTelemetry) {
        self.sample_position
            .store(telemetry.sample_position, Ordering::Relaxed);
        self.callback_count
            .store(telemetry.callback_count, Ordering::Relaxed);
        self.sample_rate
            .store(telemetry.sample_rate, Ordering::Relaxed);
        self.callback_frames
            .store(telemetry.callback_frames, Ordering::Relaxed);
        self.output_channels
            .store(u32::from(telemetry.output_channels), Ordering::Relaxed);
        self.stream_errors
            .store(telemetry.stream_errors, Ordering::Relaxed);
        self.probable_xruns
            .store(telemetry.probable_xruns, Ordering::Relaxed);
        self.command_queue_depth
            .store(telemetry.command_queue_depth, Ordering::Relaxed);
        self.pending_command_count
            .store(telemetry.pending_command_count, Ordering::Relaxed);
        self.next_pending_command_sample.store(
            telemetry.next_pending_command_sample.unwrap_or(u64::MAX),
            Ordering::Relaxed,
        );
        self.command_received
            .store(telemetry.command_diagnostics.received, Ordering::Relaxed);
        self.command_applied
            .store(telemetry.command_diagnostics.applied, Ordering::Relaxed);
        self.command_late
            .store(telemetry.command_diagnostics.late, Ordering::Relaxed);
        self.command_rejected
            .store(telemetry.command_diagnostics.rejected, Ordering::Relaxed);
        self.command_out_of_order.store(
            telemetry.command_diagnostics.out_of_order,
            Ordering::Relaxed,
        );
        self.command_queue_overflows.store(
            telemetry.command_diagnostics.command_queue_overflows,
            Ordering::Relaxed,
        );
        self.telemetry_queue_overflows.store(
            telemetry.command_diagnostics.telemetry_queue_overflows,
            Ordering::Relaxed,
        );
    }

    pub fn increment_stream_errors(&self) {
        self.stream_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn read(&self) -> AudioTelemetry {
        AudioTelemetry {
            sample_position: self.sample_position.load(Ordering::Relaxed),
            callback_count: self.callback_count.load(Ordering::Relaxed),
            sample_rate: self.sample_rate.load(Ordering::Relaxed),
            callback_frames: self.callback_frames.load(Ordering::Relaxed),
            output_channels: self.output_channels.load(Ordering::Relaxed) as u16,
            stream_errors: self.stream_errors.load(Ordering::Relaxed),
            probable_xruns: self.probable_xruns.load(Ordering::Relaxed),
            command_queue_depth: self.command_queue_depth.load(Ordering::Relaxed),
            pending_command_count: self.pending_command_count.load(Ordering::Relaxed),
            next_pending_command_sample: match self
                .next_pending_command_sample
                .load(Ordering::Relaxed)
            {
                u64::MAX => None,
                sample => Some(sample),
            },
            command_diagnostics: CommandDiagnostics {
                received: self.command_received.load(Ordering::Relaxed),
                applied: self.command_applied.load(Ordering::Relaxed),
                late: self.command_late.load(Ordering::Relaxed),
                rejected: self.command_rejected.load(Ordering::Relaxed),
                out_of_order: self.command_out_of_order.load(Ordering::Relaxed),
                command_queue_overflows: self.command_queue_overflows.load(Ordering::Relaxed),
                telemetry_queue_overflows: self.telemetry_queue_overflows.load(Ordering::Relaxed),
            },
            runtime_plan_status: RuntimePlanStatus::default(),
            event_graph_diagnostics: EventGraphDiagnostics::default(),
            ..AudioTelemetry::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publishes_callback_progress_from_audio_thread_snapshot() {
        let snapshot = RealtimeSnapshotAtomics::new();

        snapshot.publish(AudioTelemetry {
            sample_position: 512,
            callback_count: 4,
            sample_rate: 48_000,
            callback_frames: 128,
            output_channels: 2,
            stream_errors: 1,
            probable_xruns: 2,
            command_queue_depth: 6,
            pending_command_count: 7,
            next_pending_command_sample: Some(2048),
            command_diagnostics: CommandDiagnostics {
                received: 3,
                applied: 2,
                late: 1,
                rejected: 1,
                out_of_order: 1,
                command_queue_overflows: 4,
                telemetry_queue_overflows: 5,
            },
            ..AudioTelemetry::default()
        });

        let published = snapshot.read();

        assert_eq!(published.sample_position, 512);
        assert_eq!(published.callback_count, 4);
        assert_eq!(published.sample_rate, 48_000);
        assert_eq!(published.callback_frames, 128);
        assert_eq!(published.output_channels, 2);
        assert_eq!(published.stream_errors, 1);
        assert_eq!(published.probable_xruns, 2);
        assert_eq!(published.command_queue_depth, 6);
        assert_eq!(published.pending_command_count, 7);
        assert_eq!(published.next_pending_command_sample, Some(2048));
        assert_eq!(published.command_diagnostics.received, 3);
        assert_eq!(published.command_diagnostics.applied, 2);
        assert_eq!(published.command_diagnostics.late, 1);
        assert_eq!(published.command_diagnostics.rejected, 1);
        assert_eq!(published.command_diagnostics.out_of_order, 1);
        assert_eq!(published.command_diagnostics.command_queue_overflows, 4);
        assert_eq!(published.command_diagnostics.telemetry_queue_overflows, 5);
    }

    #[test]
    fn stream_error_increment_is_visible_to_snapshot_reader() {
        let snapshot = RealtimeSnapshotAtomics::new();

        snapshot.increment_stream_errors();
        snapshot.increment_stream_errors();

        assert_eq!(snapshot.read().stream_errors, 2);
    }
}
