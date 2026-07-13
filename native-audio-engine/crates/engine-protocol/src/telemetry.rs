#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AudioTelemetry {
    pub sample_position: u64,
    pub callback_count: u64,
    pub sample_rate: u32,
    pub callback_frames: u32,
    pub maximum_callback_frames: u32,
    pub output_channels: u16,
    pub callback_duration_ns: u64,
    pub maximum_callback_duration_ns: u64,
    pub callback_load: f32,
    pub stream_errors: u64,
    pub probable_xruns: u64,
    pub command_queue_depth: u32,
    pub pending_command_count: u32,
    pub next_pending_command_sample: Option<u64>,
    pub command_diagnostics: CommandDiagnostics,
    pub runtime_plan_status: RuntimePlanStatus,
    pub scheduler_diagnostics: SchedulerDiagnostics,
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
    pub active_plan_maximum_frames: Option<u32>,
    pub pending_plan_count: u32,
    pub successful_swaps: u64,
    pub rejected_swaps: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SchedulerDiagnostics {
    pub owner_generations_set: u64,
    pub sample_events_inserted: u64,
    pub beat_events_inserted: u64,
    pub beat_event_min_sample: Option<u64>,
    pub beat_event_max_sample: Option<u64>,
    pub events_dropped_capacity: u64,
    pub events_dropped_not_playing: u64,
    pub events_discarded_owner: u64,
    pub events_discarded_future_owner: u64,
    pub note_ons_dispatched: u64,
    pub note_offs_dispatched: u64,
    pub loop_reschedules: u64,
    pub loop_reschedule_skipped_disabled: u64,
    pub loop_reschedule_skipped_outside: u64,
    pub events_cleared: u64,
    pub transport_loop_enabled: bool,
    pub transport_loop_start_sample: u64,
    pub transport_loop_end_sample: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EventGraphDiagnostics {
    pub events_received: u64,
    pub route_dispatches: u64,
    pub events_emitted: u64,
    pub events_suppressed: u64,
    pub events_dropped_capacity: u64,
    pub events_dropped_depth: u64,
    pub events_dropped_budget: u64,
    pub future_events_requested: u64,
    pub future_events_rejected_late: u64,
    pub future_events_dropped_capacity: u64,
    pub future_events_dropped_scheduler_full: u64,
    pub future_events_discarded_plan_revision: u64,
    pub future_events_discarded_generation: u64,
}
