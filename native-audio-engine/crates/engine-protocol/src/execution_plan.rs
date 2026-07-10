pub const NATIVE_EXECUTION_PLAN_VERSION: u32 = 1;

pub const NODE_OSCILLATOR: u32 = 1;
pub const NODE_GAIN: u32 = 2;
pub const NODE_OUTPUT: u32 = 3;

pub const PARAM_OSCILLATOR_FREQUENCY: u32 = 1;
pub const PARAM_GAIN_GAIN: u32 = 2;

pub type NodeId = u32;
pub type BufferSlotId = u32;
pub type ParameterSlotId = u32;

#[derive(Clone, Debug, PartialEq)]
pub struct NativeExecutionPlan {
    pub version: u32,
    pub nodes: Vec<PlanNode>,
    pub buffers: Vec<AudioBufferSlot>,
    pub parameters: Vec<ParameterSlot>,
    pub audio_execution_order: Vec<NodeId>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlanNode {
    pub id: NodeId,
    pub kind: PlanNodeKind,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PlanNodeKind {
    Oscillator(OscillatorNodePlan),
    Gain(GainNodePlan),
    Output(OutputNodePlan),
    Unsupported { descriptor: u32 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct OscillatorNodePlan {
    pub frequency_parameter: ParameterSlotId,
    pub output_buffer: BufferSlotId,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GainNodePlan {
    pub gain_parameter: ParameterSlotId,
    pub input_buffer: BufferSlotId,
    pub output_buffer: BufferSlotId,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OutputNodePlan {
    pub input_buffer: BufferSlotId,
    pub output_channels: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AudioBufferSlot {
    pub id: BufferSlotId,
    pub channels: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParameterSlot {
    pub id: ParameterSlotId,
    pub node: NodeId,
    pub parameter: u32,
    pub default_value: f32,
}

pub fn diagnostic_tone_plan(
    frequency_hz: f32,
    gain: f32,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        nodes: vec![
            PlanNode {
                id: NODE_OSCILLATOR,
                kind: PlanNodeKind::Oscillator(OscillatorNodePlan {
                    frequency_parameter: PARAM_OSCILLATOR_FREQUENCY,
                    output_buffer: 1,
                }),
            },
            PlanNode {
                id: NODE_GAIN,
                kind: PlanNodeKind::Gain(GainNodePlan {
                    gain_parameter: PARAM_GAIN_GAIN,
                    input_buffer: 1,
                    output_buffer: 2,
                }),
            },
            PlanNode {
                id: NODE_OUTPUT,
                kind: PlanNodeKind::Output(OutputNodePlan {
                    input_buffer: 2,
                    output_channels,
                }),
            },
        ],
        buffers: vec![
            AudioBufferSlot { id: 1, channels: 1 },
            AudioBufferSlot { id: 2, channels: 1 },
        ],
        parameters: vec![
            ParameterSlot {
                id: PARAM_OSCILLATOR_FREQUENCY,
                node: NODE_OSCILLATOR,
                parameter: PARAM_OSCILLATOR_FREQUENCY,
                default_value: frequency_hz,
            },
            ParameterSlot {
                id: PARAM_GAIN_GAIN,
                node: NODE_GAIN,
                parameter: PARAM_GAIN_GAIN,
                default_value: gain,
            },
        ],
        audio_execution_order: vec![NODE_OSCILLATOR, NODE_GAIN, NODE_OUTPUT],
    }
}
