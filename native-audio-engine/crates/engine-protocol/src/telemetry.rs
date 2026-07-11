#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AudioTelemetry {
    pub sample_position: u64,
    pub callback_count: u64,
    pub sample_rate: u32,
    pub callback_frames: u32,
    pub output_channels: u16,
    pub callback_duration_ns: u64,
    pub maximum_callback_duration_ns: u64,
    pub callback_load: f32,
    pub stream_errors: u64,
    pub probable_xruns: u64,
    pub command_queue_depth: u32,
    pub pending_command_count: u32,
    pub command_diagnostics: CommandDiagnostics,
    pub runtime_plan_status: RuntimePlanStatus,
    pub event_graph_diagnostics: EventGraphDiagnostics,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CommandDiagnostics {
    pub received: u64,
    pub applied: u64,
    pub late: u64,
    pub rejected: u64,
    pub out_of_order: u64,
    pub command_queue_overflows: u64,
    pub telemetry_queue_overflows: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RuntimePlanStatus {
    pub active_plan_id: Option<u64>,
    pub active_plan_revision: Option<u64>,
    pub pending_plan_count: u32,
    pub successful_swaps: u64,
    pub rejected_swaps: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EventGraphDiagnostics {
    pub events_received: u64,
    pub route_dispatches: u64,
    pub events_emitted: u64,
    pub events_dropped_capacity: u64,
    pub events_dropped_depth: u64,
    pub events_dropped_budget: u64,
}
