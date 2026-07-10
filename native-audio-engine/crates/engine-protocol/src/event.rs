use crate::telemetry::AudioTelemetry;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EngineEvent {
    Telemetry(AudioTelemetry),
    CommandApplied {
        command_id: u64,
        applied_sample: u64,
        late_by_samples: u64,
    },
    CommandRejected {
        command_id: u64,
        reason: CommandRejection,
    },
    TransportStateChanged {
        playing: bool,
        at_sample: u64,
    },
    StreamError {
        code: u32,
    },
    LifecycleStarted,
    LifecycleStopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandRejection {
    PendingQueueFull,
    OutOfOrder,
    UnknownParameter,
}
