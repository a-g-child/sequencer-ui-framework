pub const NATIVE_EXECUTION_PLAN_VERSION: u32 = 1;

pub const NODE_OSCILLATOR: u32 = 1;
pub const NODE_GAIN: u32 = 2;
pub const NODE_OUTPUT: u32 = 3;
pub const NODE_VOICE: u32 = 4;

pub const PARAM_OSCILLATOR_FREQUENCY: u32 = 1;
pub const PARAM_GAIN_GAIN: u32 = 2;

pub type NodeId = u32;
pub type BufferSlotId = u32;
pub type ParameterSlotId = u32;

#[derive(Clone, Debug, PartialEq)]
pub struct NativeExecutionPlan {
    pub version: u32,
    pub plan_id: u64,
    pub plan_revision: u64,
    pub nodes: Vec<PlanNode>,
    pub buffers: Vec<AudioBufferSlot>,
    pub parameters: Vec<ParameterSlot>,
    pub event_routes: Vec<EventRoute>,
    pub audio_execution_order: Vec<NodeId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EventRoute {
    pub source_node: NodeId,
    pub destination_node: NodeId,
    pub event_mask: EventRouteMask,
    pub priority: u16,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EventRouteMask {
    pub note: bool,
}

impl EventRouteMask {
    pub const NOTE: Self = Self { note: true };

    pub fn accepts_note(self) -> bool {
        self.note
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlanNode {
    pub id: NodeId,
    pub kind: PlanNodeKind,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PlanNodeKind {
    Oscillator(OscillatorNodePlan),
    Voice(VoiceNodePlan),
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
pub struct VoiceNodePlan {
    pub output_buffer: BufferSlotId,
    pub attack_seconds: f32,
    pub decay_seconds: f32,
    pub sustain_level: f32,
    pub release_seconds: f32,
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
        plan_id: 1,
        plan_revision: 1,
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
        event_routes: vec![],
        audio_execution_order: vec![NODE_OSCILLATOR, NODE_GAIN, NODE_OUTPUT],
    }
}

pub fn monophonic_voice_plan(output_channels: u16) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_VOICE,
                kind: PlanNodeKind::Voice(VoiceNodePlan {
                    output_buffer: 1,
                    attack_seconds: 0.0,
                    decay_seconds: 0.0,
                    sustain_level: 1.0,
                    release_seconds: 0.0,
                }),
            },
            PlanNode {
                id: NODE_OUTPUT,
                kind: PlanNodeKind::Output(OutputNodePlan {
                    input_buffer: 1,
                    output_channels,
                }),
            },
        ],
        buffers: vec![AudioBufferSlot { id: 1, channels: 1 }],
        parameters: vec![],
        event_routes: vec![EventRoute {
            source_node: NODE_VOICE,
            destination_node: NODE_VOICE,
            event_mask: EventRouteMask::NOTE,
            priority: 0,
            enabled: true,
        }],
        audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
    }
}
