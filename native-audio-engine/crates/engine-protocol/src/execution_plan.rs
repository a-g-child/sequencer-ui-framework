pub const NATIVE_EXECUTION_PLAN_VERSION: u32 = 1;

pub const NODE_OSCILLATOR: u32 = 1;
pub const NODE_GAIN: u32 = 2;
pub const NODE_OUTPUT: u32 = 3;
pub const NODE_VOICE: u32 = 4;
pub const NODE_EVENT_INPUT: u32 = 5;
pub const NODE_TRANSPOSE: u32 = 6;
pub const NODE_SCALE: u32 = 7;
pub const NODE_INSTRUMENT: u32 = 8;
pub const NODE_CHORD: u32 = 9;
pub const NODE_VELOCITY: u32 = 10;
pub const NODE_EVENT_SPLITTER: u32 = 11;

pub const DEFAULT_EVENT_PORT: u16 = 0;

pub const PARAM_OSCILLATOR_FREQUENCY: u32 = 1;
pub const PARAM_GAIN_GAIN: u32 = 2;

pub type NodeId = u32;
pub type BufferSlotId = u32;
pub type ParameterSlotId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EventEndpoint {
    pub node_id: NodeId,
    pub port_id: u16,
}

pub const fn event_endpoint(node_id: NodeId) -> EventEndpoint {
    EventEndpoint {
        node_id,
        port_id: DEFAULT_EVENT_PORT,
    }
}

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
    pub source: EventEndpoint,
    pub destination: EventEndpoint,
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
    EventInput(EventInputNodePlan),
    EventSplitter(EventSplitterNodePlan),
    Oscillator(OscillatorNodePlan),
    Transpose(TransposeNodePlan),
    Scale(ScaleNodePlan),
    Velocity(VelocityNodePlan),
    Chord(ChordNodePlan),
    Instrument(InstrumentNodePlan),
    Voice(VoiceNodePlan),
    Gain(GainNodePlan),
    Output(OutputNodePlan),
    Unsupported { descriptor: u32 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct EventInputNodePlan;

/// Routing utility that re-emits the same event from fixed output ports without
/// transforming musical state.
#[derive(Clone, Debug, PartialEq)]
pub struct EventSplitterNodePlan;

#[derive(Clone, Debug, PartialEq)]
pub struct OscillatorNodePlan {
    pub frequency_parameter: ParameterSlotId,
    pub output_buffer: BufferSlotId,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransposeNodePlan {
    pub semitones: i8,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScaleNodePlan {
    pub root_note: u8,
    pub pitch_class_mask: u16,
}

impl ScaleNodePlan {
    pub const CHROMATIC_MASK: u16 = 0b1111_1111_1111;
    pub const MAJOR_MASK: u16 = 0b1010_1011_0101;
    pub const MINOR_MASK: u16 = 0b0101_1010_1101;
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChordNodePlan {
    pub intervals: Vec<i8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VelocityNodePlan {
    pub multiplier: f32,
    pub offset: f32,
    pub minimum: f32,
    pub maximum: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct InstrumentNodePlan {
    pub output_buffer: BufferSlotId,
    pub voice_count: u16,
    pub attack_seconds: f32,
    pub decay_seconds: f32,
    pub sustain_level: f32,
    pub release_seconds: f32,
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
            source: event_endpoint(NODE_VOICE),
            destination: event_endpoint(NODE_VOICE),
            event_mask: EventRouteMask::NOTE,
            priority: 0,
            enabled: true,
        }],
        audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
    }
}

pub fn transposed_monophonic_voice_plan(
    semitones: i8,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_TRANSPOSE,
                kind: PlanNodeKind::Transpose(TransposeNodePlan { semitones }),
            },
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
        event_routes: vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_TRANSPOSE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_TRANSPOSE),
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ],
        audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
    }
}

pub fn scaled_monophonic_voice_plan(
    root_note: u8,
    pitch_class_mask: u16,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_SCALE,
                kind: PlanNodeKind::Scale(ScaleNodePlan {
                    root_note,
                    pitch_class_mask,
                }),
            },
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
        event_routes: vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_SCALE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_SCALE),
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ],
        audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
    }
}

pub fn monophonic_instrument_plan(output_channels: u16) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count: 1,
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
            source: event_endpoint(NODE_EVENT_INPUT),
            destination: event_endpoint(NODE_INSTRUMENT),
            event_mask: EventRouteMask::NOTE,
            priority: 0,
            enabled: true,
        }],
        audio_execution_order: vec![NODE_INSTRUMENT, NODE_OUTPUT],
    }
}

pub fn transposed_monophonic_instrument_plan(
    semitones: i8,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_TRANSPOSE,
                kind: PlanNodeKind::Transpose(TransposeNodePlan { semitones }),
            },
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count: 1,
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
        event_routes: vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_TRANSPOSE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_TRANSPOSE),
                destination: event_endpoint(NODE_INSTRUMENT),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ],
        audio_execution_order: vec![NODE_INSTRUMENT, NODE_OUTPUT],
    }
}

pub fn scaled_monophonic_instrument_plan(
    root_note: u8,
    pitch_class_mask: u16,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_SCALE,
                kind: PlanNodeKind::Scale(ScaleNodePlan {
                    root_note,
                    pitch_class_mask,
                }),
            },
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count: 1,
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
        event_routes: vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_SCALE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_SCALE),
                destination: event_endpoint(NODE_INSTRUMENT),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ],
        audio_execution_order: vec![NODE_INSTRUMENT, NODE_OUTPUT],
    }
}

pub fn chorded_instrument_plan(
    intervals: Vec<i8>,
    voice_count: u16,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_CHORD,
                kind: PlanNodeKind::Chord(ChordNodePlan { intervals }),
            },
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count,
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
        event_routes: vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_CHORD),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_CHORD),
                destination: event_endpoint(NODE_INSTRUMENT),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ],
        audio_execution_order: vec![NODE_INSTRUMENT, NODE_OUTPUT],
    }
}

pub fn velocity_chorded_instrument_plan(
    transpose: i8,
    scale_root_note: u8,
    scale_mask: u16,
    velocity: VelocityNodePlan,
    intervals: Vec<i8>,
    voice_count: u16,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id: 1,
        plan_revision: 1,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_TRANSPOSE,
                kind: PlanNodeKind::Transpose(TransposeNodePlan {
                    semitones: transpose,
                }),
            },
            PlanNode {
                id: NODE_SCALE,
                kind: PlanNodeKind::Scale(ScaleNodePlan {
                    root_note: scale_root_note,
                    pitch_class_mask: scale_mask,
                }),
            },
            PlanNode {
                id: NODE_VELOCITY,
                kind: PlanNodeKind::Velocity(velocity),
            },
            PlanNode {
                id: NODE_CHORD,
                kind: PlanNodeKind::Chord(ChordNodePlan { intervals }),
            },
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count,
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
        event_routes: vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_TRANSPOSE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_TRANSPOSE),
                destination: event_endpoint(NODE_SCALE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_SCALE),
                destination: event_endpoint(NODE_VELOCITY),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_VELOCITY),
                destination: event_endpoint(NODE_CHORD),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_CHORD),
                destination: event_endpoint(NODE_INSTRUMENT),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ],
        audio_execution_order: vec![NODE_INSTRUMENT, NODE_OUTPUT],
    }
}
