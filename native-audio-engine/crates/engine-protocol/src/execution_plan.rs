#[derive(Clone, Debug, PartialEq)]
pub struct NativeExecutionPlan {
    pub version: u32,
    pub nodes: Vec<PlanNode>,
    pub buffers: Vec<BufferSlot>,
    pub parameters: Vec<ParameterSlot>,
    pub audio_groups: Vec<ExecutionGroup>,
    pub control_groups: Vec<ExecutionGroup>,
    pub event_routes: Vec<EventRoute>,
    pub latency_samples: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlanNode {
    pub id: u32,
    pub descriptor: u32,
    pub execution_index: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BufferSlot {
    pub id: u32,
    pub channels: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParameterSlot {
    pub id: u32,
    pub node: u32,
    pub parameter: u32,
    pub default_value: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExecutionGroup {
    pub id: u32,
    pub node_ids: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EventRoute {
    pub id: u32,
    pub source_node: u32,
    pub target_node: u32,
}
