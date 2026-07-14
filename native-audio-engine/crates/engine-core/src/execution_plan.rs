use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
};

use engine_dsp::{MonophonicVoice, MonophonicVoiceState, SmoothedParameter};
use engine_protocol::{
    ArpeggiatorOctaveDirection, ArpeggiatorPattern, ArpeggiatorPhaseMode, AudioBufferSlot,
    BufferSlotId, EventEndpoint, EventGraphDiagnostics, EventRouteMask, FutureEventLifetime,
    FutureEventOwner, FutureEventRequest, NativeExecutionPlan, NodeId, ParameterSlotId,
    PlanNodeKind, ScheduledEngineEvent, TempoMapSnapshot, TransportLoop, ARPEGGIATOR_PORT_INPUT,
    ARPEGGIATOR_PORT_NOTES, ARPEGGIATOR_PORT_TICK, ARPEGGIATOR_PORT_TICK_INPUT, DEFAULT_EVENT_PORT,
    EVENT_DELAY_PORT_DELAYED, EVENT_DELAY_PORT_INPUT, NATIVE_EXECUTION_PLAN_VERSION,
    SCALE_PORT_ACCEPTED, SCALE_PORT_INPUT, SCALE_PORT_REJECTED,
};

pub const MAX_EVENT_DEPTH: u16 = 32;
pub const MAX_EVENTS_PER_BLOCK: usize = 1024;
pub const MAX_FUTURE_EVENTS_PER_DISPATCH: usize = 1024;
pub const MAX_CHORD_INTERVALS: usize = 16;
pub const MAX_INSTRUMENT_VOICES: u16 = 128;
pub const MAX_ARPEGGIATOR_HELD_NOTES: u16 = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanValidationError {
    UnsupportedVersion,
    DuplicateNodeId,
    UnknownNode,
    UnknownBuffer,
    UnknownParameter,
    UnsupportedNodeType,
    ChannelMismatch,
    MissingOutput,
    MultipleOutputs,
    InvalidBlockCapacity,
    InvalidEventRouteMask,
    UnknownEventSourcePort,
    UnknownEventDestinationPort,
    IncompatibleEventRoute,
    DuplicateEventPort,
    InvalidEventDelay,
    InvalidArpeggiatorConfig,
    InvalidChordIntervals,
    DuplicateChordInterval,
    InvalidVelocityTransform,
    InvalidInstrumentVoiceCount,
    InvalidInstrumentVoiceConfig,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateTransferError {
    UnknownOldNode,
    UnknownNewNode,
    NodeTypeMismatch,
    IncompatibleTransferKind,
    IncompatibleInstrumentPool,
    IncompatibleArpeggiator,
    DuplicateOldNode,
    DuplicateNewNode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateTransferPlanningError {
    DuplicateOldStableId,
    DuplicateNewStableId,
    NodeTypeChanged { stable_id: u64 },
    IncompatibleInstrumentPool { stable_id: u64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessRange {
    pub start_frame: usize,
    pub end_frame: usize,
}

pub struct PreparedExecutionPlan {
    plan_id: u64,
    plan_revision: u64,
    nodes: Box<[RuntimeNode]>,
    buffers: AudioBufferArena,
    parameters: Box<[RuntimeParameter]>,
    execution_order: Box<[usize]>,
    event_graph: PreparedEventGraph,
    event_work_queue: FixedEventQueue,
    future_event_queue: FixedFutureEventQueue,
    event_graph_diagnostics: EventGraphDiagnostics,
    node_metadata: Box<[RuntimeNodeMetadata]>,
    output_scratch: Box<[f32]>,
    output_channels: usize,
    output_node_count: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PreparedExecutionPlanMetadata {
    pub nodes: Box<[RuntimeNodeMetadata]>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RuntimeNodeMetadata {
    pub stable_id: u64,
    pub runtime_index: u32,
    pub node_kind: RuntimeNodeKind,
    pub instrument: Option<InstrumentRuntimeMetadata>,
    pub arpeggiator: Option<ArpeggiatorCompatibility>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InstrumentRuntimeMetadata {
    pub voice_count: u16,
    pub voice_config: VoiceConfig,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArpeggiatorCompatibility {
    pub step_beats: f64,
    pub gate_ratio: f32,
    pub phase_mode: ArpeggiatorPhaseMode,
    pub pattern: ArpeggiatorPattern,
    pub maximum_held_notes: u16,
    pub octave_count: u8,
    pub octave_direction: ArpeggiatorOctaveDirection,
    pub random_seed: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoiceConfig {
    pub attack_seconds: f32,
    pub decay_seconds: f32,
    pub sustain_level: f32,
    pub release_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RuntimeEventContext {
    pub input_port: u16,
    pub sample_position: u64,
    pub tempo_map: TempoMapSnapshot,
    pub transport_loop: TransportLoop,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InstrumentDiagnostics {
    pub active_voices: u32,
    pub peak_active_voices: u32,
    pub voice_steals: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeNodeKind {
    EventInput,
    EventSplitter,
    EventDelay,
    Arpeggiator,
    Oscillator,
    Transpose,
    Scale,
    Velocity,
    Chord,
    Instrument,
    Voice,
    Gain,
    Output,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventPortDirection {
    Input,
    Output,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EventPortMetadata {
    pub id: u16,
    pub direction: EventPortDirection,
    pub mask: EventRouteMask,
}

const EMPTY_EVENT_MASK: EventRouteMask = EventRouteMask {
    note: false,
    tick: false,
};
const DEFAULT_EVENT_PORTS: [EventPortMetadata; 2] = [
    EventPortMetadata {
        id: DEFAULT_EVENT_PORT,
        direction: EventPortDirection::Input,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: DEFAULT_EVENT_PORT,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::NOTE,
    },
];
const EVENT_SPLITTER_PORTS: [EventPortMetadata; 4] = [
    EventPortMetadata {
        id: DEFAULT_EVENT_PORT,
        direction: EventPortDirection::Input,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: EventSplitterNode::OUTPUT_A,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: EventSplitterNode::OUTPUT_B,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: EventSplitterNode::OUTPUT_EMPTY,
        direction: EventPortDirection::Output,
        mask: EMPTY_EVENT_MASK,
    },
];
const SCALE_EVENT_PORTS: [EventPortMetadata; 3] = [
    EventPortMetadata {
        id: SCALE_PORT_INPUT,
        direction: EventPortDirection::Input,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: SCALE_PORT_ACCEPTED,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: SCALE_PORT_REJECTED,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::NOTE,
    },
];
const EVENT_DELAY_PORTS: [EventPortMetadata; 2] = [
    EventPortMetadata {
        id: EVENT_DELAY_PORT_INPUT,
        direction: EventPortDirection::Input,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: EVENT_DELAY_PORT_DELAYED,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::NOTE,
    },
];
const ARPEGGIATOR_EVENT_PORTS: [EventPortMetadata; 4] = [
    EventPortMetadata {
        id: ARPEGGIATOR_PORT_INPUT,
        direction: EventPortDirection::Input,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: ARPEGGIATOR_PORT_TICK_INPUT,
        direction: EventPortDirection::Input,
        mask: EventRouteMask::TICK,
    },
    EventPortMetadata {
        id: ARPEGGIATOR_PORT_NOTES,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::NOTE,
    },
    EventPortMetadata {
        id: ARPEGGIATOR_PORT_TICK,
        direction: EventPortDirection::Output,
        mask: EventRouteMask::TICK,
    },
];

pub struct RuntimeCompiler {
    maximum_frames: usize,
}

impl RuntimeCompiler {
    pub fn new(maximum_frames: usize) -> Self {
        Self { maximum_frames }
    }

    pub fn compile(
        &self,
        plan: &NativeExecutionPlan,
    ) -> Result<PreparedExecutionPlan, PlanValidationError> {
        PreparedExecutionPlan::compile(plan, self.maximum_frames)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanStateTransfer {
    pub entries: Box<[StateTransferEntry]>,
}

impl PlanStateTransfer {
    pub fn empty() -> Self {
        Self {
            entries: Vec::new().into_boxed_slice(),
        }
    }
}

impl Default for PlanStateTransfer {
    fn default() -> Self {
        Self::empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StateTransferEntry {
    pub old_node_index: u32,
    pub new_node_index: u32,
    pub kind: StateTransferKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateTransferKind {
    OscillatorPhase,
    GainSmoother,
    InstrumentPool,
    Arpeggiator,
}

impl PreparedExecutionPlan {
    pub fn prepare(
        plan: &NativeExecutionPlan,
        maximum_frames: usize,
    ) -> Result<Self, PlanValidationError> {
        RuntimeCompiler::new(maximum_frames).compile(plan)
    }

    fn compile(
        plan: &NativeExecutionPlan,
        maximum_frames: usize,
    ) -> Result<Self, PlanValidationError> {
        if maximum_frames == 0 {
            return Err(PlanValidationError::InvalidBlockCapacity);
        }

        if plan.version != NATIVE_EXECUTION_PLAN_VERSION {
            return Err(PlanValidationError::UnsupportedVersion);
        }

        validate_unique_node_ids(plan)?;
        validate_event_port_declarations(plan)?;

        let buffers = AudioBufferArena::new(&plan.buffers, maximum_frames)?;
        let parameters = plan
            .parameters
            .iter()
            .map(|parameter| RuntimeParameter {
                id: parameter.id,
                default_value: parameter.default_value,
                smoother: SmoothedParameter::new(parameter.default_value),
            })
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let mut output_node_count = 0;
        let mut output_channels = 0;
        let nodes = plan
            .nodes
            .iter()
            .map(|node| match &node.kind {
                PlanNodeKind::EventInput(_) => Ok(RuntimeNode::EventInput(EventInputNode)),
                PlanNodeKind::EventSplitter(_) => Ok(RuntimeNode::EventSplitter(EventSplitterNode)),
                PlanNodeKind::EventDelay(node_plan) => {
                    if node_plan.delay_samples == 0 {
                        return Err(PlanValidationError::InvalidEventDelay);
                    }

                    Ok(RuntimeNode::EventDelay(EventDelayNode {
                        delay_samples: node_plan.delay_samples,
                    }))
                }
                PlanNodeKind::Arpeggiator(node_plan) => {
                    validate_arpeggiator_config(
                        node_plan.step_beats,
                        node_plan.gate_ratio,
                        node_plan.maximum_held_notes,
                        node_plan.octave_count,
                    )?;

                    Ok(RuntimeNode::Arpeggiator(ArpeggiatorNode::new(
                        node_plan.step_beats,
                        node_plan.gate_ratio,
                        node_plan.maximum_held_notes,
                        node_plan.phase_mode,
                        node_plan.pattern,
                        node_plan.octave_count,
                        node_plan.octave_direction,
                        node_plan.random_seed,
                    )))
                }
                PlanNodeKind::Oscillator(node_plan) => {
                    let output_buffer = buffer_index(plan, node_plan.output_buffer)?;
                    let frequency_parameter = parameter_index(plan, node_plan.frequency_parameter)?;

                    require_channels(plan, node_plan.output_buffer, 1)?;

                    Ok(RuntimeNode::Oscillator(OscillatorNode {
                        phase: 0.0,
                        frequency_parameter,
                        output_buffer,
                    }))
                }
                PlanNodeKind::Voice(node_plan) => {
                    let output_buffer = buffer_index(plan, node_plan.output_buffer)?;

                    require_channels(plan, node_plan.output_buffer, 1)?;
                    validate_voice_config(VoiceConfig {
                        attack_seconds: node_plan.attack_seconds,
                        decay_seconds: node_plan.decay_seconds,
                        sustain_level: node_plan.sustain_level,
                        release_seconds: node_plan.release_seconds,
                    })?;

                    Ok(RuntimeNode::Voice(MonoInstrumentNode {
                        voice: MonophonicVoice::new(
                            node_plan.attack_seconds,
                            node_plan.decay_seconds,
                            node_plan.sustain_level,
                            node_plan.release_seconds,
                        ),
                        output_buffer,
                    }))
                }
                PlanNodeKind::Transpose(node_plan) => Ok(RuntimeNode::Transpose(TransposeNode {
                    semitones: node_plan.semitones,
                })),
                PlanNodeKind::Scale(node_plan) => Ok(RuntimeNode::Scale(ScaleNode {
                    root_note: node_plan.root_note,
                    pitch_class_mask: node_plan.pitch_class_mask,
                })),
                PlanNodeKind::Velocity(node_plan) => {
                    validate_velocity_transform(
                        node_plan.multiplier,
                        node_plan.offset,
                        node_plan.minimum,
                        node_plan.maximum,
                    )?;

                    Ok(RuntimeNode::Velocity(VelocityNode {
                        multiplier: node_plan.multiplier,
                        offset: node_plan.offset,
                        minimum: node_plan.minimum,
                        maximum: node_plan.maximum,
                    }))
                }
                PlanNodeKind::Chord(node_plan) => Ok(RuntimeNode::Chord(ChordNode {
                    intervals: prepare_chord_intervals(&node_plan.intervals)?,
                })),
                PlanNodeKind::Instrument(node_plan) => {
                    let output_buffer = buffer_index(plan, node_plan.output_buffer)?;
                    let voice_config = VoiceConfig {
                        attack_seconds: node_plan.attack_seconds,
                        decay_seconds: node_plan.decay_seconds,
                        sustain_level: node_plan.sustain_level,
                        release_seconds: node_plan.release_seconds,
                    };

                    require_channels(plan, node_plan.output_buffer, 1)?;
                    validate_instrument_voice_count(node_plan.voice_count)?;
                    validate_voice_config(voice_config)?;

                    Ok(RuntimeNode::Instrument(InstrumentNode {
                        voices: (0..node_plan.voice_count)
                            .map(|_| {
                                InstrumentVoice::new(
                                    voice_config.attack_seconds,
                                    voice_config.decay_seconds,
                                    voice_config.sustain_level,
                                    voice_config.release_seconds,
                                )
                            })
                            .collect::<Vec<_>>()
                            .into_boxed_slice(),
                        voice_config,
                        output_buffer,
                        allocation_sequence: 0,
                        release_sequence: 0,
                        voice_steals: 0,
                        peak_active_voices: 0,
                    }))
                }
                PlanNodeKind::Gain(node_plan) => {
                    let input_buffer = buffer_index(plan, node_plan.input_buffer)?;
                    let output_buffer = buffer_index(plan, node_plan.output_buffer)?;
                    let gain_parameter = parameter_index(plan, node_plan.gain_parameter)?;

                    if buffer_channels(plan, node_plan.input_buffer)?
                        != buffer_channels(plan, node_plan.output_buffer)?
                    {
                        return Err(PlanValidationError::ChannelMismatch);
                    }

                    Ok(RuntimeNode::Gain(GainNode {
                        gain_parameter,
                        input_buffer,
                        output_buffer,
                    }))
                }
                PlanNodeKind::Output(node_plan) => {
                    output_node_count += 1;
                    output_channels = node_plan.output_channels as usize;
                    let input_buffer = buffer_index(plan, node_plan.input_buffer)?;

                    if node_plan.output_channels == 0 {
                        return Err(PlanValidationError::ChannelMismatch);
                    }

                    Ok(RuntimeNode::Output(OutputNode {
                        input_buffer,
                        output_channels: node_plan.output_channels as usize,
                    }))
                }
                PlanNodeKind::Unsupported { .. } => Err(PlanValidationError::UnsupportedNodeType),
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_boxed_slice();

        if output_node_count == 0 {
            return Err(PlanValidationError::MissingOutput);
        }

        if output_node_count > 1 {
            return Err(PlanValidationError::MultipleOutputs);
        }

        let execution_order = plan
            .audio_execution_order
            .iter()
            .map(|node_id| node_index(plan, *node_id))
            .collect::<Result<Vec<_>, _>>()?
            .into_boxed_slice();
        let event_graph = PreparedEventGraph::prepare(plan)?;
        let node_metadata = plan
            .nodes
            .iter()
            .enumerate()
            .map(|(index, node)| {
                let node_kind = runtime_node_kind(&node.kind)?;

                Ok(RuntimeNodeMetadata {
                    stable_id: node.id as u64,
                    runtime_index: index as u32,
                    node_kind,
                    instrument: instrument_runtime_metadata(&node.kind),
                    arpeggiator: arpeggiator_compatibility(&node.kind),
                })
            })
            .collect::<Result<Vec<_>, PlanValidationError>>()?
            .into_boxed_slice();

        Ok(Self {
            plan_id: plan.plan_id,
            plan_revision: plan.plan_revision,
            nodes,
            buffers,
            parameters,
            execution_order,
            event_graph,
            event_work_queue: FixedEventQueue::default(),
            future_event_queue: FixedFutureEventQueue::default(),
            event_graph_diagnostics: EventGraphDiagnostics::default(),
            node_metadata,
            output_scratch: vec![0.0; maximum_frames * output_channels.max(1)].into_boxed_slice(),
            output_channels: output_channels.max(1),
            output_node_count,
        })
    }

    pub fn process(
        &mut self,
        output: &mut [f32],
        sample_rate: f64,
        output_channels: usize,
        range: ProcessRange,
    ) {
        process_nodes(
            &mut self.nodes,
            &mut self.buffers,
            &mut self.parameters,
            &self.execution_order,
            output,
            sample_rate,
            output_channels,
            range,
        );
    }

    pub fn process_to_scratch(
        &mut self,
        sample_rate: f64,
        output_channels: usize,
        range: ProcessRange,
    ) -> Option<&[f32]> {
        if output_channels > self.output_channels {
            return None;
        }

        let channels = output_channels.max(1);
        let required_samples = range.end_frame.checked_mul(channels)?;

        if required_samples > self.output_scratch.len() {
            return None;
        }

        for frame in range.start_frame..range.end_frame {
            let frame_start = frame * channels;
            let frame_end = frame_start + channels;

            self.output_scratch[frame_start..frame_end].fill(0.0);
        }

        process_nodes(
            &mut self.nodes,
            &mut self.buffers,
            &mut self.parameters,
            &self.execution_order,
            &mut self.output_scratch[..required_samples],
            sample_rate,
            output_channels,
            range,
        );

        Some(&self.output_scratch[..required_samples])
    }

    pub fn clear_range(&mut self, range: ProcessRange) {
        self.buffers.clear_range(range);
    }

    pub fn set_parameter(&mut self, parameter_id: u32, value: f32, ramp_samples: u32) -> bool {
        let Some(parameter) = self
            .parameters
            .iter_mut()
            .find(|parameter| parameter.id == parameter_id)
        else {
            return false;
        };

        parameter.smoother.set_target(value, ramp_samples);
        true
    }

    pub fn reset(&mut self) {
        for parameter in self.parameters.iter_mut() {
            parameter.smoother = SmoothedParameter::new(parameter.default_value);
        }

        for node in self.nodes.iter_mut() {
            node.reset();
        }
    }

    pub fn dispatch_event(&mut self, event: ScheduledEngineEvent) -> bool {
        self.dispatch_event_from(event_endpoint_for_event(event), event)
    }

    pub fn dispatch_event_with_tempo(
        &mut self,
        event: ScheduledEngineEvent,
        tempo_map: TempoMapSnapshot,
    ) -> bool {
        self.dispatch_event_from_with_tempo_and_loop(
            event_endpoint_for_event(event),
            event,
            tempo_map,
            TransportLoop::default(),
        )
    }

    pub fn dispatch_event_from(
        &mut self,
        source: EventEndpoint,
        event: ScheduledEngineEvent,
    ) -> bool {
        self.dispatch_event_from_with_tempo(source, event, TempoMapSnapshot::default())
    }

    pub fn dispatch_event_from_with_tempo(
        &mut self,
        source: EventEndpoint,
        event: ScheduledEngineEvent,
        tempo_map: TempoMapSnapshot,
    ) -> bool {
        self.dispatch_event_from_with_tempo_and_loop(
            source,
            event,
            tempo_map,
            TransportLoop::default(),
        )
    }

    pub fn dispatch_event_from_with_tempo_and_loop(
        &mut self,
        source: EventEndpoint,
        event: ScheduledEngineEvent,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> bool {
        self.future_event_queue.clear();
        let source_node = source.node_id;
        let source_endpoint_index = match self.event_graph.source_node_index(source_node) {
            Some(source_node_index) => {
                let Some(source_endpoint_index) = self
                    .event_graph
                    .source_endpoint_index(source_node_index, source.port_id)
                else {
                    self.event_graph_diagnostics.events_received = self
                        .event_graph_diagnostics
                        .events_received
                        .saturating_add(1);
                    return false;
                };

                source_endpoint_index
            }
            None => {
                let Some(source_endpoint_index) =
                    self.event_graph.fallback_source_endpoint_index(event)
                else {
                    return false;
                };

                source_endpoint_index
            }
        };

        self.event_work_queue.clear();
        self.event_work_queue
            .push(EmittedRuntimeEvent {
                source_endpoint_index,
                event,
                depth: 0,
            })
            .expect("cleared event work queue should accept root event");

        let mut handled = false;
        let mut processed_events = 0;

        while let Some(runtime_event) = self.event_work_queue.pop() {
            if processed_events >= MAX_EVENTS_PER_BLOCK {
                self.event_graph_diagnostics.events_dropped_budget = self
                    .event_graph_diagnostics
                    .events_dropped_budget
                    .saturating_add(1);
                break;
            }

            processed_events += 1;
            self.event_graph_diagnostics.events_received = self
                .event_graph_diagnostics
                .events_received
                .saturating_add(1);

            let range = self
                .event_graph
                .route_range(runtime_event.source_endpoint_index);

            for route_index in range.start..range.end() {
                let route = self.event_graph.routes[route_index as usize];

                if !route.accepts(runtime_event.event) {
                    continue;
                }

                self.event_graph_diagnostics.route_dispatches = self
                    .event_graph_diagnostics
                    .route_dispatches
                    .saturating_add(1);

                let mut immediate_diagnostics = EventGraphDiagnostics::default();
                let mut future_diagnostics = EventGraphDiagnostics::default();
                let mut emitter = EventEmitter {
                    queue: &mut self.event_work_queue,
                    event_graph: &self.event_graph,
                    source_node_index: route.destination_node_index,
                    source_node_id: self
                        .event_graph
                        .source_node_id(route.destination_node_index)
                        .unwrap_or_default(),
                    parent_input_port: route.destination_port_id,
                    parent_depth: runtime_event.depth,
                    diagnostics: &mut immediate_diagnostics,
                };
                let mut future_emitter = FutureEventEmitter {
                    queue: &mut self.future_event_queue,
                    plan_id: self.plan_id,
                    plan_revision: self.plan_revision,
                    source_node_id: self
                        .event_graph
                        .source_node_id(route.destination_node_index)
                        .unwrap_or_default(),
                    current_sample: runtime_event.event.at_sample(),
                    tempo_map,
                    transport_loop,
                    diagnostics: &mut future_diagnostics,
                };
                let context = RuntimeEventContext {
                    input_port: route.destination_port_id,
                    sample_position: runtime_event.event.at_sample(),
                    tempo_map,
                    transport_loop,
                };

                handled |= self.nodes[route.destination_node_index as usize].process_event(
                    &runtime_event.event,
                    context,
                    &mut emitter,
                    &mut future_emitter,
                );
                add_event_graph_diagnostics(
                    &mut self.event_graph_diagnostics,
                    immediate_diagnostics,
                );
                add_event_graph_diagnostics(&mut self.event_graph_diagnostics, future_diagnostics);
            }
        }

        handled
    }

    pub fn take_future_event_request(&mut self) -> Option<FutureEventRequest> {
        self.future_event_queue.pop()
    }

    pub fn regenerate_future_events_for_tempo_change(
        &mut self,
        current_sample: u64,
        committed_horizon: u64,
        previous_tempo: TempoMapSnapshot,
        new_tempo: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) {
        let plan_id = self.plan_id;
        let plan_revision = self.plan_revision;

        for (node_index, node) in self.nodes.iter_mut().enumerate() {
            let node_id = self
                .node_metadata
                .get(node_index)
                .map(|metadata| metadata.stable_id as NodeId)
                .unwrap_or_default();

            let Some(request) = node.future_request_for_tempo_change(
                plan_id,
                plan_revision,
                node_id,
                current_sample,
                committed_horizon,
                previous_tempo,
                new_tempo,
                transport_loop,
            ) else {
                continue;
            };

            if self.future_event_queue.push(request).is_err() {
                self.event_graph_diagnostics.future_events_dropped_capacity = self
                    .event_graph_diagnostics
                    .future_events_dropped_capacity
                    .saturating_add(1);
            } else {
                self.event_graph_diagnostics.future_events_requested = self
                    .event_graph_diagnostics
                    .future_events_requested
                    .saturating_add(1);
            }
        }
    }

    pub fn regenerate_future_events_after_state_transfer(
        &mut self,
        current_sample: u64,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) {
        let plan_id = self.plan_id;
        let plan_revision = self.plan_revision;

        for (node_index, node) in self.nodes.iter().enumerate() {
            let node_id = self
                .node_metadata
                .get(node_index)
                .map(|metadata| metadata.stable_id as NodeId)
                .unwrap_or_default();

            let Some(request) = node.future_request_for_next_tick(
                plan_id,
                plan_revision,
                node_id,
                current_sample,
                tempo_map,
                transport_loop,
            ) else {
                continue;
            };

            if self.future_event_queue.push(request).is_err() {
                self.event_graph_diagnostics.future_events_dropped_capacity = self
                    .event_graph_diagnostics
                    .future_events_dropped_capacity
                    .saturating_add(1);
            } else {
                self.event_graph_diagnostics.future_events_requested = self
                    .event_graph_diagnostics
                    .future_events_requested
                    .saturating_add(1);
            }
        }
    }

    pub fn record_future_scheduler_full(&mut self) {
        self.event_graph_diagnostics
            .future_events_dropped_scheduler_full = self
            .event_graph_diagnostics
            .future_events_dropped_scheduler_full
            .saturating_add(1);
    }

    pub fn record_future_plan_revision_discard(&mut self) {
        self.event_graph_diagnostics
            .future_events_discarded_plan_revision = self
            .event_graph_diagnostics
            .future_events_discarded_plan_revision
            .saturating_add(1);
    }

    pub fn record_future_generation_discard(&mut self) {
        self.event_graph_diagnostics
            .future_events_discarded_generation = self
            .event_graph_diagnostics
            .future_events_discarded_generation
            .saturating_add(1);
    }

    pub fn future_event_generation_is_current(
        &self,
        source: EventEndpoint,
        generation: u64,
    ) -> bool {
        let Some(source_node_index) = self.event_graph.source_node_index(source.node_id) else {
            return false;
        };

        self.nodes[source_node_index as usize].future_generation_is_current(generation)
    }

    pub fn event_graph_diagnostics(&self) -> EventGraphDiagnostics {
        self.event_graph_diagnostics
    }

    pub fn event_route_count(&self) -> usize {
        self.event_graph.routes.len()
    }

    pub fn event_route_destination_at(&self, index: usize) -> Option<u32> {
        self.event_graph
            .routes
            .get(index)
            .map(|route| route.destination_node_index)
    }

    pub fn event_route_destination_port_at(&self, index: usize) -> Option<u16> {
        self.event_graph
            .routes
            .get(index)
            .map(|route| route.destination_port_id)
    }

    pub fn event_route_range_for_source(&self, source_node: NodeId) -> Option<(u32, u32)> {
        self.event_route_range_for_source_endpoint(source_node, DEFAULT_EVENT_PORT)
    }

    pub fn event_route_range_for_source_endpoint(
        &self,
        source_node: NodeId,
        source_port_id: u16,
    ) -> Option<(u32, u32)> {
        let source_node_index = self.event_graph.source_node_index(source_node)?;
        let source_endpoint_index = self
            .event_graph
            .source_endpoint_index(source_node_index, source_port_id)?;
        let range = self.event_graph.route_range(source_endpoint_index);

        Some((range.start, range.len))
    }

    pub fn output_node_count(&self) -> usize {
        self.output_node_count
    }

    pub fn output_channels(&self) -> usize {
        self.output_channels
    }

    pub fn maximum_frames(&self) -> usize {
        self.buffers.maximum_frames
    }

    pub fn plan_id(&self) -> u64 {
        self.plan_id
    }

    pub fn plan_revision(&self) -> u64 {
        self.plan_revision
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn metadata(&self) -> PreparedExecutionPlanMetadata {
        PreparedExecutionPlanMetadata {
            nodes: self.node_metadata.clone(),
        }
    }

    pub fn instrument_diagnostics(&self, node_id: NodeId) -> Option<InstrumentDiagnostics> {
        let node_index = self
            .node_metadata
            .iter()
            .find(|node| node.stable_id == node_id as u64)?
            .runtime_index as usize;

        match self.nodes.get(node_index)? {
            RuntimeNode::Instrument(node) => Some(node.diagnostics()),
            _ => None,
        }
    }

    pub fn first_instrument_diagnostics(&self) -> Option<InstrumentDiagnostics> {
        let node_index = self
            .node_metadata
            .iter()
            .find(|node| node.instrument.is_some())?
            .runtime_index as usize;

        match self.nodes.get(node_index)? {
            RuntimeNode::Instrument(node) => Some(node.diagnostics()),
            _ => None,
        }
    }

    pub fn apply_state_transfer_from(
        &mut self,
        old_plan: &PreparedExecutionPlan,
        transfer: &PlanStateTransfer,
    ) -> Result<(), StateTransferError> {
        validate_state_transfer(old_plan, self, transfer)?;

        for entry in transfer.entries.iter().copied() {
            let old_index = entry.old_node_index as usize;
            let new_index = entry.new_node_index as usize;

            match entry.kind {
                StateTransferKind::OscillatorPhase => {
                    let phase = old_plan.nodes[old_index]
                        .oscillator_phase()
                        .ok_or(StateTransferError::IncompatibleTransferKind)?;

                    self.nodes[new_index]
                        .set_oscillator_phase(phase)
                        .ok_or(StateTransferError::IncompatibleTransferKind)?;
                }
                StateTransferKind::GainSmoother => {
                    let old_parameter = old_plan.nodes[old_index]
                        .gain_parameter()
                        .ok_or(StateTransferError::IncompatibleTransferKind)?;
                    let new_parameter = self.nodes[new_index]
                        .gain_parameter()
                        .ok_or(StateTransferError::IncompatibleTransferKind)?;
                    let state = old_plan.parameters[old_parameter].smoother.state();

                    self.parameters[new_parameter].smoother.restore_state(state);
                }
                StateTransferKind::InstrumentPool => {
                    let old_node = &old_plan.nodes[old_index];
                    let new_node = &mut self.nodes[new_index];

                    new_node.transfer_instrument_pool_from(old_node)?;
                }
                StateTransferKind::Arpeggiator => {
                    let old_node = &old_plan.nodes[old_index];
                    let new_node = &mut self.nodes[new_index];

                    new_node.transfer_arpeggiator_from(old_node)?;
                }
            }
        }

        Ok(())
    }
}

pub fn build_state_transfer(
    old_plan: &PreparedExecutionPlanMetadata,
    new_plan: &PreparedExecutionPlanMetadata,
) -> Result<PlanStateTransfer, StateTransferPlanningError> {
    reject_duplicate_stable_ids(
        &old_plan.nodes,
        StateTransferPlanningError::DuplicateOldStableId,
    )?;
    reject_duplicate_stable_ids(
        &new_plan.nodes,
        StateTransferPlanningError::DuplicateNewStableId,
    )?;

    let mut entries = Vec::new();

    for new_node in new_plan.nodes.iter().copied() {
        let Some(old_node) = old_plan
            .nodes
            .iter()
            .copied()
            .find(|old_node| old_node.stable_id == new_node.stable_id)
        else {
            continue;
        };

        if old_node.node_kind != new_node.node_kind {
            return Err(StateTransferPlanningError::NodeTypeChanged {
                stable_id: new_node.stable_id,
            });
        }

        let Some(kind) = state_transfer_kind_for_node(new_node.node_kind) else {
            continue;
        };

        if kind == StateTransferKind::InstrumentPool && old_node.instrument != new_node.instrument {
            return Err(StateTransferPlanningError::IncompatibleInstrumentPool {
                stable_id: new_node.stable_id,
            });
        }

        if kind == StateTransferKind::Arpeggiator && old_node.arpeggiator != new_node.arpeggiator {
            continue;
        }

        entries.push((
            new_node.stable_id,
            StateTransferEntry {
                old_node_index: old_node.runtime_index,
                new_node_index: new_node.runtime_index,
                kind,
            },
        ));
    }

    entries
        .sort_by_key(|(stable_id, entry)| (*stable_id, entry.old_node_index, entry.new_node_index));

    Ok(PlanStateTransfer {
        entries: entries
            .into_iter()
            .map(|(_, entry)| entry)
            .collect::<Vec<_>>()
            .into_boxed_slice(),
    })
}

pub const PREPARED_PLAN_TRANSFER_CAPACITY: usize = 4;
pub const RETIRED_PLAN_TRANSFER_CAPACITY: usize = 4;

pub struct PreparedPlanTransfer {
    pub transfer_id: u64,
    pub plan_id: u64,
    pub plan_revision: u64,
    pub state_transfer: PlanStateTransfer,
    pub plan: PreparedExecutionPlan,
}

impl PreparedPlanTransfer {
    pub fn new(
        transfer_id: u64,
        plan: PreparedExecutionPlan,
        state_transfer: PlanStateTransfer,
    ) -> Self {
        Self {
            transfer_id,
            plan_id: plan.plan_id(),
            plan_revision: plan.plan_revision(),
            state_transfer,
            plan,
        }
    }
}

pub struct RetiredExecutionPlan {
    pub plan_id: u64,
    pub plan_revision: u64,
    pub plan: PreparedExecutionPlan,
}

pub struct PendingPlanSet {
    slots: [Option<PreparedPlanTransfer>; PREPARED_PLAN_TRANSFER_CAPACITY],
}

impl Default for PendingPlanSet {
    fn default() -> Self {
        Self {
            slots: std::array::from_fn(|_| None),
        }
    }
}

impl PendingPlanSet {
    pub fn insert(&mut self, transfer: PreparedPlanTransfer) -> Result<(), PreparedPlanTransfer> {
        if self.contains_transfer_id(transfer.transfer_id) {
            return Err(transfer);
        }

        if let Some(slot) = self.slots.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(transfer);
            return Ok(());
        }

        Err(transfer)
    }

    pub fn take(&mut self, transfer_id: u64) -> Option<PreparedPlanTransfer> {
        let slot = self.slots.iter_mut().find(|slot| {
            slot.as_ref()
                .is_some_and(|slot| slot.transfer_id == transfer_id)
        })?;

        slot.take()
    }

    pub fn len(&self) -> usize {
        self.slots.iter().filter(|slot| slot.is_some()).count()
    }

    pub fn contains_transfer_id(&self, transfer_id: u64) -> bool {
        self.slots.iter().any(|slot| {
            slot.as_ref()
                .is_some_and(|slot| slot.transfer_id == transfer_id)
        })
    }

    pub fn is_full(&self) -> bool {
        self.slots.iter().all(Option::is_some)
    }
}

struct TransferQueue<T: Send, const N: usize> {
    buffer: Box<[UnsafeCell<MaybeUninit<T>>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
    overflow_count: AtomicU64,
}

unsafe impl<T: Send, const N: usize> Send for TransferQueue<T, N> {}
unsafe impl<T: Send, const N: usize> Sync for TransferQueue<T, N> {}

impl<T: Send, const N: usize> TransferQueue<T, N> {
    fn new() -> Self {
        assert!(N > 1, "transfer queue capacity must be greater than one");

        let mut buffer = Vec::with_capacity(N);

        for _ in 0..N {
            buffer.push(UnsafeCell::new(MaybeUninit::uninit()));
        }

        Self {
            buffer: buffer.into_boxed_slice(),
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            overflow_count: AtomicU64::new(0),
        }
    }

    fn push(&self, value: T) -> Result<(), T> {
        let head = self.head.load(Ordering::Relaxed);
        let next_head = (head + 1) % N;

        if next_head == self.tail.load(Ordering::Acquire) {
            self.overflow_count.fetch_add(1, Ordering::Relaxed);
            return Err(value);
        }

        unsafe {
            (*self.buffer[head].get()).write(value);
        }
        self.head.store(next_head, Ordering::Release);
        Ok(())
    }

    fn pop(&self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);

        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }

        let value = unsafe { (*self.buffer[tail].get()).assume_init_read() };
        self.tail.store((tail + 1) % N, Ordering::Release);

        Some(value)
    }

    fn overflow_count(&self) -> u64 {
        self.overflow_count.load(Ordering::Relaxed)
    }

    fn is_full(&self) -> bool {
        let head = self.head.load(Ordering::Relaxed);
        let next_head = (head + 1) % N;

        next_head == self.tail.load(Ordering::Acquire)
    }
}

impl<T: Send, const N: usize> Drop for TransferQueue<T, N> {
    fn drop(&mut self) {
        while self.pop().is_some() {}
    }
}

pub struct PreparedPlanSender {
    queue: Arc<TransferQueue<PreparedPlanTransfer, PREPARED_PLAN_TRANSFER_CAPACITY>>,
}

pub struct PreparedPlanReceiver {
    queue: Arc<TransferQueue<PreparedPlanTransfer, PREPARED_PLAN_TRANSFER_CAPACITY>>,
}

pub struct RetiredPlanSender {
    queue: Arc<TransferQueue<RetiredExecutionPlan, RETIRED_PLAN_TRANSFER_CAPACITY>>,
}

pub struct RetiredPlanReceiver {
    queue: Arc<TransferQueue<RetiredExecutionPlan, RETIRED_PLAN_TRANSFER_CAPACITY>>,
}

pub fn prepared_plan_transfer_queue() -> (PreparedPlanSender, PreparedPlanReceiver) {
    let queue = Arc::new(TransferQueue::new());

    (
        PreparedPlanSender {
            queue: queue.clone(),
        },
        PreparedPlanReceiver { queue },
    )
}

pub fn retired_plan_queue() -> (RetiredPlanSender, RetiredPlanReceiver) {
    let queue = Arc::new(TransferQueue::new());

    (
        RetiredPlanSender {
            queue: queue.clone(),
        },
        RetiredPlanReceiver { queue },
    )
}

impl PreparedPlanSender {
    pub fn push(&self, transfer: PreparedPlanTransfer) -> Result<(), PreparedPlanTransfer> {
        self.queue.push(transfer)
    }

    pub fn overflow_count(&self) -> u64 {
        self.queue.overflow_count()
    }
}

impl PreparedPlanReceiver {
    pub fn pop(&self) -> Option<PreparedPlanTransfer> {
        self.queue.pop()
    }
}

impl RetiredPlanSender {
    pub fn push(&self, retired: RetiredExecutionPlan) -> Result<(), RetiredExecutionPlan> {
        self.queue.push(retired)
    }

    pub fn is_full(&self) -> bool {
        self.queue.is_full()
    }
}

impl RetiredPlanReceiver {
    pub fn pop(&self) -> Option<RetiredExecutionPlan> {
        self.queue.pop()
    }
}

struct NodeProcessContext {
    sample_rate: f64,
    output_channels: usize,
    range: ProcessRange,
}

enum RuntimeNode {
    EventInput(EventInputNode),
    EventSplitter(EventSplitterNode),
    EventDelay(EventDelayNode),
    Arpeggiator(ArpeggiatorNode),
    Oscillator(OscillatorNode),
    Transpose(TransposeNode),
    Scale(ScaleNode),
    Velocity(VelocityNode),
    Chord(ChordNode),
    Instrument(InstrumentNode),
    Voice(MonoInstrumentNode),
    Gain(GainNode),
    Output(OutputNode),
    #[cfg(test)]
    Forwarding(ForwardingNode),
    #[cfg(test)]
    Burst(BurstNode),
    #[cfg(test)]
    Recording(RecordingNode),
}

impl RuntimeNode {
    fn process(
        &mut self,
        context: &NodeProcessContext,
        buffers: &mut AudioBufferArena,
        parameters: &mut [RuntimeParameter],
        output: &mut [f32],
    ) {
        match self {
            Self::EventInput(_) => {}
            Self::EventSplitter(_) => {}
            Self::EventDelay(_) => {}
            Self::Arpeggiator(_) => {}
            Self::Oscillator(node) => node.process(context, buffers, parameters),
            Self::Transpose(_) => {}
            Self::Scale(_) => {}
            Self::Velocity(_) => {}
            Self::Chord(_) => {}
            Self::Instrument(node) => node.process(context, buffers),
            Self::Voice(node) => node.process(context, buffers),
            Self::Gain(node) => node.process(context, buffers, parameters),
            Self::Output(node) => node.process(context, buffers, output),
            #[cfg(test)]
            Self::Forwarding(_) | Self::Burst(_) | Self::Recording(_) => {}
        }
    }

    fn reset(&mut self) {
        match self {
            Self::Oscillator(node) => node.phase = 0.0,
            Self::Arpeggiator(node) => node.reset(),
            Self::Instrument(node) => node.panic(),
            Self::Voice(node) => node.voice.panic(),
            _ => {}
        }
    }

    fn node_type(&self) -> RuntimeNodeKind {
        match self {
            Self::EventInput(_) => RuntimeNodeKind::EventInput,
            Self::EventSplitter(_) => RuntimeNodeKind::EventSplitter,
            Self::EventDelay(_) => RuntimeNodeKind::EventDelay,
            Self::Arpeggiator(_) => RuntimeNodeKind::Arpeggiator,
            Self::Oscillator(_) => RuntimeNodeKind::Oscillator,
            Self::Transpose(_) => RuntimeNodeKind::Transpose,
            Self::Scale(_) => RuntimeNodeKind::Scale,
            Self::Velocity(_) => RuntimeNodeKind::Velocity,
            Self::Chord(_) => RuntimeNodeKind::Chord,
            Self::Instrument(_) => RuntimeNodeKind::Instrument,
            Self::Voice(_) => RuntimeNodeKind::Voice,
            Self::Gain(_) => RuntimeNodeKind::Gain,
            Self::Output(_) => RuntimeNodeKind::Output,
            #[cfg(test)]
            Self::Forwarding(_) | Self::Burst(_) | Self::Recording(_) => RuntimeNodeKind::Gain,
        }
    }

    fn oscillator_phase(&self) -> Option<f64> {
        match self {
            Self::Oscillator(node) => Some(node.phase),
            _ => None,
        }
    }

    fn set_oscillator_phase(&mut self, phase: f64) -> Option<()> {
        match self {
            Self::Oscillator(node) => {
                node.phase = phase;
                Some(())
            }
            _ => None,
        }
    }

    fn gain_parameter(&self) -> Option<usize> {
        match self {
            Self::Gain(node) => Some(node.gain_parameter),
            _ => None,
        }
    }

    fn instrument_pool_compatible_with(&self, other: &RuntimeNode) -> bool {
        match (self, other) {
            (Self::Instrument(old_node), Self::Instrument(new_node)) => {
                old_node.compatible_with(new_node)
            }
            _ => false,
        }
    }

    fn arpeggiator_compatible_with(&self, other: &RuntimeNode) -> bool {
        match (self, other) {
            (Self::Arpeggiator(old_node), Self::Arpeggiator(new_node)) => {
                old_node.compatible_with(new_node)
            }
            _ => false,
        }
    }

    fn transfer_instrument_pool_from(
        &mut self,
        old_node: &RuntimeNode,
    ) -> Result<(), StateTransferError> {
        match (old_node, self) {
            (RuntimeNode::Instrument(old_node), RuntimeNode::Instrument(new_node)) => {
                new_node.transfer_from(old_node)
            }
            _ => Err(StateTransferError::IncompatibleTransferKind),
        }
    }

    fn transfer_arpeggiator_from(
        &mut self,
        old_node: &RuntimeNode,
    ) -> Result<(), StateTransferError> {
        match (old_node, self) {
            (RuntimeNode::Arpeggiator(old_node), RuntimeNode::Arpeggiator(new_node)) => {
                new_node.transfer_from(old_node)
            }
            _ => Err(StateTransferError::IncompatibleTransferKind),
        }
    }

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        context: RuntimeEventContext,
        emitter: &mut EventEmitter<'_>,
        future_emitter: &mut FutureEventEmitter<'_>,
    ) -> bool {
        match self {
            Self::EventSplitter(node) => node.process_event(event, context, emitter),
            Self::EventDelay(node) => node.process_event(event, context, future_emitter),
            Self::Arpeggiator(node) => node.process_event(event, context, emitter, future_emitter),
            Self::Transpose(node) => node.process_event(event, emitter),
            Self::Scale(node) => node.process_event(event, emitter),
            Self::Velocity(node) => node.process_event(event, emitter),
            Self::Chord(node) => node.process_event(event, emitter),
            Self::Instrument(node) => node.process_event(event, emitter),
            Self::Voice(node) => node.process_event(event, emitter),
            #[cfg(test)]
            Self::Forwarding(node) => node.process_event(event, emitter),
            #[cfg(test)]
            Self::Burst(node) => node.process_event(event, emitter),
            #[cfg(test)]
            Self::Recording(node) => node.process_event(event, emitter),
            _ => false,
        }
    }

    fn future_generation_is_current(&self, generation: u64) -> bool {
        match self {
            Self::Arpeggiator(node) => node.generation_is_current(generation),
            _ => generation == 0,
        }
    }

    fn future_request_for_tempo_change(
        &mut self,
        plan_id: u64,
        plan_revision: u64,
        node_id: NodeId,
        current_sample: u64,
        committed_horizon: u64,
        previous_tempo: TempoMapSnapshot,
        new_tempo: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<FutureEventRequest> {
        match self {
            Self::Arpeggiator(node) => node.future_request_for_tempo_change(
                plan_id,
                plan_revision,
                node_id,
                current_sample,
                committed_horizon,
                previous_tempo,
                new_tempo,
                transport_loop,
            ),
            _ => None,
        }
    }

    fn future_request_for_next_tick(
        &self,
        plan_id: u64,
        plan_revision: u64,
        node_id: NodeId,
        current_sample: u64,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<FutureEventRequest> {
        match self {
            Self::Arpeggiator(node) => node.future_request_for_next_tick(
                plan_id,
                plan_revision,
                node_id,
                current_sample,
                tempo_map,
                transport_loop,
            ),
            _ => None,
        }
    }
}

struct EventInputNode;

struct EventDelayNode {
    delay_samples: u32,
}

struct ArpeggiatorNode {
    held_notes: Box<[Option<HeldNote>]>,
    step_beats: f64,
    gate_ratio: f32,
    phase_mode: ArpeggiatorPhaseMode,
    pattern: ArpeggiatorPattern,
    octave_count: u8,
    octave_direction: ArpeggiatorOctaveDirection,
    random_seed: u64,
    random_state: u64,
    held_count: usize,
    current_index: usize,
    played_order_counter: u64,
    sequence_index: u64,
    origin_beat: f64,
    generation: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct HeldNote {
    note: u8,
    velocity: f32,
    played_order: u64,
}

struct EventSplitterNode;

impl EventDelayNode {
    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        context: RuntimeEventContext,
        future_emitter: &mut FutureEventEmitter<'_>,
    ) -> bool {
        if context.input_port != EVENT_DELAY_PORT_INPUT {
            return false;
        }

        let at_sample = context
            .sample_position
            .saturating_add(self.delay_samples as u64);

        future_emitter
            .request_from(EVENT_DELAY_PORT_DELAYED, *event, at_sample)
            .is_ok()
    }
}

impl ArpeggiatorNode {
    fn new(
        step_beats: f64,
        gate_ratio: f32,
        maximum_held_notes: u16,
        phase_mode: ArpeggiatorPhaseMode,
        pattern: ArpeggiatorPattern,
        octave_count: u8,
        octave_direction: ArpeggiatorOctaveDirection,
        random_seed: u64,
    ) -> Self {
        Self {
            held_notes: vec![None; maximum_held_notes as usize].into_boxed_slice(),
            step_beats,
            gate_ratio,
            phase_mode,
            pattern,
            octave_count,
            octave_direction,
            random_seed,
            random_state: initial_arpeggiator_random_state(random_seed),
            held_count: 0,
            current_index: 0,
            played_order_counter: 0,
            sequence_index: 1,
            origin_beat: 0.0,
            generation: 0,
        }
    }

    fn reset(&mut self) {
        self.held_notes.fill(None);
        self.held_count = 0;
        self.current_index = 0;
        self.played_order_counter = 0;
        self.sequence_index = 1;
        self.origin_beat = 0.0;
        self.generation = self.generation.saturating_add(1);
    }

    fn compatible_with(&self, other: &Self) -> bool {
        self.step_beats == other.step_beats
            && self.gate_ratio == other.gate_ratio
            && self.phase_mode == other.phase_mode
            && self.pattern == other.pattern
            && self.octave_count == other.octave_count
            && self.octave_direction == other.octave_direction
            && self.random_seed == other.random_seed
            && self.held_notes.len() == other.held_notes.len()
    }

    fn transfer_from(&mut self, old_node: &Self) -> Result<(), StateTransferError> {
        if !old_node.compatible_with(self) {
            return Err(StateTransferError::IncompatibleArpeggiator);
        }

        self.held_notes.copy_from_slice(&old_node.held_notes);
        self.held_count = old_node.held_count;
        self.current_index = old_node.current_index;
        self.played_order_counter = old_node.played_order_counter;
        self.sequence_index = old_node.sequence_index;
        self.origin_beat = old_node.origin_beat;
        self.random_state = old_node.random_state;
        self.generation = old_node.generation.saturating_add(1);

        if self.held_count == 0 {
            self.current_index = 0;
            self.sequence_index = 1;
        } else {
            self.current_index %= self.expanded_pattern_length();
        }

        Ok(())
    }

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        context: RuntimeEventContext,
        emitter: &mut EventEmitter<'_>,
        future_emitter: &mut FutureEventEmitter<'_>,
    ) -> bool {
        match *event {
            ScheduledEngineEvent::NoteOn { note, velocity, .. } => {
                if context.input_port != ARPEGGIATOR_PORT_INPUT {
                    return false;
                }

                let was_empty = self.held_count == 0;

                if self.add_or_update_note(note, velocity) {
                    if was_empty {
                        self.restart_sequence(context);
                    }

                    self.schedule_tick(future_emitter);
                }
                true
            }
            ScheduledEngineEvent::NoteOff { note, .. } => {
                if context.input_port != ARPEGGIATOR_PORT_INPUT {
                    return false;
                }

                if self.remove_note(note) && self.held_count > 0 {
                    self.schedule_tick(future_emitter);
                }
                true
            }
            ScheduledEngineEvent::ArpeggiatorTick { generation, .. } => {
                if context.input_port != ARPEGGIATOR_PORT_TICK_INPUT
                    || generation != self.generation
                    || self.held_count == 0
                {
                    return false;
                }

                let at_sample = context.sample_position;
                let emitted = if let Some(note) = self.next_note(context) {
                    let tick_beat = context.tempo_map.sample_to_beat(at_sample);
                    let note_off_sample = context
                        .tempo_map
                        .beat_to_sample(tick_beat + self.step_beats * self.gate_ratio as f64);

                    let note_on = ScheduledEngineEvent::NoteOn {
                        target_node: future_emitter.source_node_id(),
                        note: note.note,
                        velocity: note.velocity,
                        at_sample,
                    };
                    let note_off = ScheduledEngineEvent::NoteOff {
                        target_node: future_emitter.source_node_id(),
                        note: note.note,
                        at_sample: note_off_sample,
                    };
                    let emitted = emitter.emit_from(ARPEGGIATOR_PORT_NOTES, note_on).is_ok();

                    let _ = future_emitter.request_from_lifetime(
                        ARPEGGIATOR_PORT_NOTES,
                        note_off,
                        note_off_sample,
                        FutureEventLifetime::CompletionRequired,
                        0,
                    );
                    emitted
                } else {
                    true
                };

                self.sequence_index = self.sequence_index.saturating_add(1);
                self.schedule_tick(future_emitter);
                emitted
            }
        }
    }

    fn add_or_update_note(&mut self, note: u8, velocity: f32) -> bool {
        if let Some(existing) = self
            .held_notes
            .iter_mut()
            .filter_map(Option::as_mut)
            .find(|held| held.note == note)
        {
            existing.velocity = velocity;
            self.invalidate_generation();
            return true;
        }

        if self.held_count >= self.held_notes.len() {
            return false;
        }

        if let Some(slot) = self.held_notes.iter_mut().find(|slot| slot.is_none()) {
            let played_order = self.played_order_counter;

            self.played_order_counter = self.played_order_counter.saturating_add(1);
            *slot = Some(HeldNote {
                note,
                velocity,
                played_order,
            });
            self.held_count += 1;
            self.sort_held_notes();
            self.invalidate_generation();
            return true;
        }

        false
    }

    fn remove_note(&mut self, note: u8) -> bool {
        let Some(slot) = self
            .held_notes
            .iter_mut()
            .find(|slot| slot.is_some_and(|held| held.note == note))
        else {
            return false;
        };

        *slot = None;
        self.held_count = self.held_count.saturating_sub(1);
        self.sort_held_notes();
        self.invalidate_generation();
        true
    }

    fn invalidate_generation(&mut self) {
        self.generation = self.generation.saturating_add(1);
        if self.held_count == 0 {
            self.current_index = 0;
            self.sequence_index = 1;
            return;
        }

        self.current_index %= self.expanded_pattern_length();
    }

    fn restart_sequence(&mut self, context: RuntimeEventContext) {
        self.origin_beat = context.tempo_map.sample_to_beat(context.sample_position);
        self.sequence_index = 1;
    }

    fn sort_held_notes(&mut self) {
        let mut write_index = 0;

        for read_index in 0..self.held_notes.len() {
            if let Some(note) = self.held_notes[read_index].take() {
                self.held_notes[write_index] = Some(note);
                write_index += 1;
            }
        }

        for slot in self.held_notes.iter_mut().skip(write_index) {
            *slot = None;
        }

        for index in 1..write_index {
            let note = self.held_notes[index]
                .take()
                .expect("compacted held note should exist");
            let mut insert_index = index;

            while insert_index > 0
                && self.held_notes[insert_index - 1]
                    .is_some_and(|candidate| candidate.note > note.note)
            {
                self.held_notes[insert_index] = self.held_notes[insert_index - 1].take();
                insert_index -= 1;
            }

            self.held_notes[insert_index] = Some(note);
        }
    }

    fn next_note(&mut self, context: RuntimeEventContext) -> Option<HeldNote> {
        if self.held_count == 0 {
            return None;
        }

        let expanded_index = self.next_pattern_index(context);

        self.current_index = (expanded_index + 1) % self.expanded_pattern_length();

        let note = self.note_for_expanded_pattern_index(expanded_index)?;
        Some(note)
    }

    fn next_pattern_index(&mut self, context: RuntimeEventContext) -> usize {
        if self.pattern == ArpeggiatorPattern::Random {
            if let Some(step_index) = self.loop_locked_step_index(
                context.sample_position,
                context.tempo_map,
                context.transport_loop,
            ) {
                return random_index_from_seed(
                    self.random_seed,
                    step_index,
                    self.expanded_pattern_length(),
                );
            }

            return self.next_free_running_random_index();
        }

        self.loop_locked_pattern_index(
            context.sample_position,
            context.tempo_map,
            context.transport_loop,
        )
        .unwrap_or(self.current_index)
    }

    fn next_free_running_random_index(&mut self) -> usize {
        self.random_state = next_arpeggiator_random_state(self.random_state);
        (self.random_state % self.expanded_pattern_length() as u64) as usize
    }

    fn loop_locked_pattern_index(
        &self,
        sample_position: u64,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<usize> {
        Some(
            self.loop_locked_step_index(sample_position, tempo_map, transport_loop)? as usize
                % self.expanded_pattern_length(),
        )
    }

    fn loop_locked_step_index(
        &self,
        sample_position: u64,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<u64> {
        if self.phase_mode != ArpeggiatorPhaseMode::LoopLocked
            || !transport_loop.enabled
            || transport_loop.end_sample <= transport_loop.start_sample
        {
            return None;
        }

        let loop_length_samples = transport_loop
            .end_sample
            .saturating_sub(transport_loop.start_sample);
        let samples_since_loop_start = sample_position.saturating_sub(transport_loop.start_sample);
        let at_loop_boundary =
            samples_since_loop_start > 0 && samples_since_loop_start % loop_length_samples == 0;
        let loop_iteration = if at_loop_boundary {
            samples_since_loop_start
                .checked_div(loop_length_samples)?
                .saturating_sub(1)
        } else {
            samples_since_loop_start.checked_div(loop_length_samples)?
        };
        let loop_start_sample = transport_loop
            .start_sample
            .saturating_add(loop_length_samples.saturating_mul(loop_iteration));
        let loop_end_sample = loop_start_sample.saturating_add(loop_length_samples);
        let loop_start_beat = tempo_map.sample_to_beat(loop_start_sample);
        let loop_end_beat = tempo_map.sample_to_beat(loop_end_sample);
        let loop_length_beats = loop_end_beat - loop_start_beat;

        if !loop_length_beats.is_finite() || loop_length_beats <= 0.0 {
            return None;
        }

        let relative_beat = if at_loop_boundary {
            loop_length_beats
        } else {
            (tempo_map.sample_to_beat(sample_position) - loop_start_beat).max(0.0)
        };
        let ratio = relative_beat / self.step_beats;
        let step_index = if ratio.fract().abs() < f64::EPSILON {
            ratio as u64
        } else {
            ratio.ceil() as u64
        }
        .saturating_sub(1);

        Some(step_index)
    }

    fn pattern_length(&self) -> usize {
        match self.pattern {
            ArpeggiatorPattern::UpDown if self.held_count > 1 => self.held_count * 2 - 2,
            _ => self.held_count,
        }
    }

    fn octave_pattern_length(&self) -> usize {
        match self.octave_direction {
            ArpeggiatorOctaveDirection::UpDown if self.octave_count > 1 => {
                self.octave_count as usize * 2 - 2
            }
            _ => self.octave_count as usize,
        }
    }

    fn expanded_pattern_length(&self) -> usize {
        self.pattern_length() * self.octave_pattern_length()
    }

    fn note_for_expanded_pattern_index(&self, index: usize) -> Option<HeldNote> {
        // Octave expansion is layered: walk the note pattern inside one octave,
        // then advance the octave layer. A note-pattern UpDown and an octave
        // UpDown are therefore independent phases, not one flattened phrase.
        let base_pattern_length = self.pattern_length();
        let base_index = index % base_pattern_length;
        let octave_step = index / base_pattern_length;
        let octave = self.octave_for_pattern_index(octave_step)?;
        let mut note = self.note_for_pattern_index(base_index)?;
        let expanded_note = note.note as i16 + octave as i16 * 12;

        if !(0..=127).contains(&expanded_note) {
            return None;
        }

        note.note = expanded_note as u8;
        Some(note)
    }

    fn octave_for_pattern_index(&self, index: usize) -> Option<i8> {
        let count = self.octave_count as usize;

        if count == 0 {
            return None;
        }

        let octave = match self.octave_direction {
            ArpeggiatorOctaveDirection::Up => index % count,
            ArpeggiatorOctaveDirection::Down => index % count,
            ArpeggiatorOctaveDirection::UpDown => {
                if count == 1 {
                    0
                } else {
                    let period = self.octave_pattern_length();
                    let position = index % period;

                    if position < count {
                        position
                    } else {
                        period - position
                    }
                }
            }
        };

        match self.octave_direction {
            ArpeggiatorOctaveDirection::Up | ArpeggiatorOctaveDirection::UpDown => {
                Some(octave as i8)
            }
            ArpeggiatorOctaveDirection::Down => Some(-(octave as i8)),
        }
    }

    fn note_for_pattern_index(&self, index: usize) -> Option<HeldNote> {
        match self.pattern {
            ArpeggiatorPattern::Ascending => self.pitch_order_note(index),
            ArpeggiatorPattern::Descending => self.pitch_order_note(
                self.held_count
                    .checked_sub(1)?
                    .checked_sub(index % self.held_count)?,
            ),
            ArpeggiatorPattern::UpDown => {
                if self.held_count == 1 {
                    return self.pitch_order_note(0);
                }

                let period = self.pattern_length();
                let position = index % period;
                let pitch_index = if position < self.held_count {
                    position
                } else {
                    period - position
                };

                self.pitch_order_note(pitch_index)
            }
            ArpeggiatorPattern::PlayedOrder => self.played_order_note(index),
            ArpeggiatorPattern::Random => self.pitch_order_note(index % self.held_count),
        }
    }

    fn pitch_order_note(&self, index: usize) -> Option<HeldNote> {
        self.held_notes.get(index).copied().flatten()
    }

    fn played_order_note(&self, index: usize) -> Option<HeldNote> {
        let target_index = index % self.held_count;
        let mut lower_bound = None;
        let mut selected_note = None;

        for _ in 0..=target_index {
            selected_note = None;
            let mut selected_order = u64::MAX;

            for note in self.held_notes.iter().filter_map(|note| *note) {
                if lower_bound.is_none_or(|order| note.played_order > order)
                    && note.played_order < selected_order
                {
                    selected_order = note.played_order;
                    selected_note = Some(note);
                }
            }

            lower_bound = selected_note.map(|note| note.played_order);
        }

        selected_note
    }

    fn schedule_tick(&self, future_emitter: &mut FutureEventEmitter<'_>) {
        let Some(at_sample) = self.next_tick_sample(
            future_emitter.current_sample,
            future_emitter.tempo_map,
            future_emitter.transport_loop,
        ) else {
            return;
        };
        let _ = future_emitter.request_from_lifetime(
            ARPEGGIATOR_PORT_TICK,
            ScheduledEngineEvent::ArpeggiatorTick {
                target_node: future_emitter.source_node_id(),
                generation: self.generation,
                at_sample,
            },
            at_sample,
            FutureEventLifetime::GenerationBound,
            self.generation,
        );
    }

    fn future_request_for_next_tick(
        &self,
        plan_id: u64,
        plan_revision: u64,
        node_id: NodeId,
        current_sample: u64,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<FutureEventRequest> {
        let at_sample = self.next_tick_sample(current_sample, tempo_map, transport_loop)?;

        if at_sample <= current_sample {
            return None;
        }

        Some(FutureEventRequest {
            source: EventEndpoint {
                node_id,
                port_id: ARPEGGIATOR_PORT_TICK,
            },
            event: ScheduledEngineEvent::ArpeggiatorTick {
                target_node: node_id,
                generation: self.generation,
                at_sample,
            },
            at_sample,
            owner: FutureEventOwner::generation_bound(
                plan_id,
                plan_revision,
                node_id,
                self.generation,
            ),
        })
    }

    fn next_tick_sample(
        &self,
        current_sample: u64,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<u64> {
        if self.held_count == 0 {
            return None;
        }

        match self.phase_mode {
            ArpeggiatorPhaseMode::FreeRunning => {
                let tick_beat = self.origin_beat + self.sequence_index as f64 * self.step_beats;
                Some(tempo_map.beat_to_sample(tick_beat))
            }
            ArpeggiatorPhaseMode::LoopLocked => {
                self.loop_locked_next_tick_sample(current_sample, tempo_map, transport_loop)
            }
        }
    }

    fn loop_locked_next_tick_sample(
        &self,
        current_sample: u64,
        tempo_map: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<u64> {
        if !transport_loop.enabled || transport_loop.end_sample <= transport_loop.start_sample {
            return self.next_tick_sample_free_running(tempo_map);
        }

        let loop_length_samples = transport_loop
            .end_sample
            .saturating_sub(transport_loop.start_sample);
        let loop_iteration = current_sample
            .saturating_sub(transport_loop.start_sample)
            .checked_div(loop_length_samples)
            .unwrap_or(0);
        let loop_start_sample = transport_loop
            .start_sample
            .saturating_add(loop_length_samples.saturating_mul(loop_iteration));
        let loop_end_sample = loop_start_sample.saturating_add(loop_length_samples);
        let loop_start_beat = tempo_map.sample_to_beat(loop_start_sample);
        let loop_end_beat = tempo_map.sample_to_beat(loop_end_sample);
        let loop_length_beats = loop_end_beat - loop_start_beat;

        if !loop_length_beats.is_finite() || loop_length_beats <= 0.0 {
            return self.next_tick_sample_free_running(tempo_map);
        }

        let current_beat = tempo_map.sample_to_beat(current_sample);
        let relative_beat = (current_beat - loop_start_beat).max(0.0);
        let next_step_index = (relative_beat / self.step_beats).floor() as u64 + 1;
        let next_relative_beat = next_step_index as f64 * self.step_beats;

        if next_relative_beat >= loop_length_beats {
            Some(loop_end_sample)
        } else {
            Some(tempo_map.beat_to_sample(loop_start_beat + next_relative_beat))
        }
    }

    fn next_tick_sample_free_running(&self, tempo_map: TempoMapSnapshot) -> Option<u64> {
        if self.held_count == 0 {
            return None;
        }

        let tick_beat = self.origin_beat + self.sequence_index as f64 * self.step_beats;
        Some(tempo_map.beat_to_sample(tick_beat))
    }

    fn future_request_for_tempo_change(
        &mut self,
        plan_id: u64,
        plan_revision: u64,
        node_id: NodeId,
        current_sample: u64,
        committed_horizon: u64,
        previous_tempo: TempoMapSnapshot,
        new_tempo: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) -> Option<FutureEventRequest> {
        if self.held_count == 0 {
            return None;
        }

        let previous_sample =
            self.next_tick_sample(current_sample, previous_tempo, transport_loop)?;

        if previous_sample < committed_horizon {
            return None;
        }

        let at_sample = self.next_tick_sample(current_sample, new_tempo, transport_loop)?;

        if at_sample <= current_sample {
            return None;
        }

        self.generation = self.generation.saturating_add(1);

        Some(FutureEventRequest {
            source: EventEndpoint {
                node_id,
                port_id: ARPEGGIATOR_PORT_TICK,
            },
            event: ScheduledEngineEvent::ArpeggiatorTick {
                target_node: node_id,
                generation: self.generation,
                at_sample,
            },
            at_sample,
            owner: FutureEventOwner::generation_bound(
                plan_id,
                plan_revision,
                node_id,
                self.generation,
            ),
        })
    }

    fn generation_is_current(&self, generation: u64) -> bool {
        generation == 0 || generation == self.generation
    }
}

impl EventSplitterNode {
    const OUTPUT_A: u16 = 1;
    const OUTPUT_B: u16 = 2;
    const OUTPUT_EMPTY: u16 = 3;

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        context: RuntimeEventContext,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        if context.input_port != DEFAULT_EVENT_PORT {
            return false;
        }

        let _ = emitter.emit_from(Self::OUTPUT_A, *event);
        let _ = emitter.emit_from(Self::OUTPUT_B, *event);
        true
    }
}

struct OscillatorNode {
    phase: f64,
    frequency_parameter: usize,
    output_buffer: usize,
}

struct TransposeNode {
    semitones: i8,
}

struct ScaleNode {
    root_note: u8,
    pitch_class_mask: u16,
}

struct VelocityNode {
    multiplier: f32,
    offset: f32,
    minimum: f32,
    maximum: f32,
}

struct ChordNode {
    intervals: Box<[i8]>,
}

struct InstrumentNode {
    voices: Box<[InstrumentVoice]>,
    voice_config: VoiceConfig,
    output_buffer: usize,
    allocation_sequence: u64,
    release_sequence: u64,
    voice_steals: u64,
    peak_active_voices: u32,
}

struct InstrumentVoice {
    voice: MonophonicVoice,
    note: Option<u8>,
    started_at: u64,
    released_at: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct InstrumentVoiceState {
    voice: MonophonicVoiceState,
    note: Option<u8>,
    started_at: u64,
    released_at: Option<u64>,
}

struct MonoInstrumentNode {
    voice: MonophonicVoice,
    output_buffer: usize,
}

impl TransposeNode {
    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        match *event {
            ScheduledEngineEvent::NoteOn {
                target_node,
                note,
                velocity,
                at_sample,
            } => {
                let Some(note) = transpose_note(note, self.semitones) else {
                    emitter.suppress();
                    return true;
                };

                emitter
                    .emit(ScheduledEngineEvent::NoteOn {
                        target_node,
                        note,
                        velocity,
                        at_sample,
                    })
                    .is_ok()
            }
            ScheduledEngineEvent::NoteOff {
                target_node,
                note,
                at_sample,
            } => {
                let Some(note) = transpose_note(note, self.semitones) else {
                    emitter.suppress();
                    return true;
                };

                emitter
                    .emit(ScheduledEngineEvent::NoteOff {
                        target_node,
                        note,
                        at_sample,
                    })
                    .is_ok()
            }
            ScheduledEngineEvent::ArpeggiatorTick { .. } => false,
        }
    }
}

fn transpose_note(note: u8, semitones: i8) -> Option<u8> {
    let transposed = note as i16 + semitones as i16;

    (0..=127).contains(&transposed).then_some(transposed as u8)
}

impl ScaleNode {
    const OUTPUT_ACCEPTED: u16 = SCALE_PORT_ACCEPTED;
    const OUTPUT_REJECTED: u16 = SCALE_PORT_REJECTED;

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        // Scale configuration is fixed for a prepared plan. If scale parameters become
        // dynamic, note-off should follow the note-on mapping instead of rechecking here.
        let note = match *event {
            ScheduledEngineEvent::NoteOn { note, .. }
            | ScheduledEngineEvent::NoteOff { note, .. } => note,
            ScheduledEngineEvent::ArpeggiatorTick { .. } => return false,
        };

        if !self.accepts_note(note) {
            return emitter.emit_from(Self::OUTPUT_REJECTED, *event).is_ok();
        }

        emitter.emit_from(Self::OUTPUT_ACCEPTED, *event).is_ok()
    }

    fn accepts_note(&self, note: u8) -> bool {
        let root = self.root_note % 12;
        let pitch_class = (note % 12).wrapping_add(12).wrapping_sub(root) % 12;
        let mask = self.pitch_class_mask & 0x0fff;

        mask & (1 << pitch_class) != 0
    }
}

impl VelocityNode {
    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        match *event {
            ScheduledEngineEvent::NoteOn {
                target_node,
                note,
                velocity,
                at_sample,
            } => {
                let velocity =
                    (velocity * self.multiplier + self.offset).clamp(self.minimum, self.maximum);

                emitter
                    .emit(ScheduledEngineEvent::NoteOn {
                        target_node,
                        note,
                        velocity,
                        at_sample,
                    })
                    .is_ok()
            }
            ScheduledEngineEvent::NoteOff { .. } => emitter.emit(*event).is_ok(),
            ScheduledEngineEvent::ArpeggiatorTick { .. } => false,
        }
    }
}

impl ChordNode {
    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        match *event {
            ScheduledEngineEvent::NoteOn {
                target_node,
                note,
                velocity,
                at_sample,
            } => {
                for interval in self.intervals.iter().copied() {
                    let Some(note) = transpose_note(note, interval) else {
                        emitter.suppress();
                        continue;
                    };

                    if emitter
                        .emit(ScheduledEngineEvent::NoteOn {
                            target_node,
                            note,
                            velocity,
                            at_sample,
                        })
                        .is_err()
                    {
                        return true;
                    }
                }

                true
            }
            ScheduledEngineEvent::NoteOff {
                target_node,
                note,
                at_sample,
            } => {
                for interval in self.intervals.iter().copied() {
                    let Some(note) = transpose_note(note, interval) else {
                        emitter.suppress();
                        continue;
                    };

                    if emitter
                        .emit(ScheduledEngineEvent::NoteOff {
                            target_node,
                            note,
                            at_sample,
                        })
                        .is_err()
                    {
                        return true;
                    }
                }

                true
            }
            ScheduledEngineEvent::ArpeggiatorTick { .. } => false,
        }
    }
}

impl InstrumentNode {
    fn process(&mut self, context: &NodeProcessContext, buffers: &mut AudioBufferArena) {
        let output = buffers.slot_mut(self.output_buffer);

        for frame in context.range.start_frame..context.range.end_frame {
            let mut sample = 0.0;

            for voice in self.voices.iter_mut() {
                sample += voice.voice.next_sample(context.sample_rate);

                if voice.voice.active_note().is_none() {
                    voice.note = None;
                    voice.released_at = None;
                }
            }

            output[frame] = sample;
        }
    }

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        _emitter: &mut EventEmitter<'_>,
    ) -> bool {
        match *event {
            ScheduledEngineEvent::NoteOn { note, velocity, .. } => {
                self.note_on(note, velocity);
                true
            }
            ScheduledEngineEvent::NoteOff { note, .. } => {
                self.note_off(note);
                true
            }
            ScheduledEngineEvent::ArpeggiatorTick { .. } => false,
        }
    }

    fn note_on(&mut self, note: u8, velocity: f32) {
        let Some(index) = self.select_voice_for_note_on(note) else {
            return;
        };
        let was_steal = self.voices[index].note.is_some()
            && self.voices[index].released_at.is_none()
            && self.voices[index].note != Some(note);

        if was_steal {
            self.voice_steals = self.voice_steals.saturating_add(1);
        }

        self.allocation_sequence = self.allocation_sequence.saturating_add(1);
        self.voices[index].note = Some(note);
        self.voices[index].started_at = self.allocation_sequence;
        self.voices[index].released_at = None;
        self.voices[index].voice.note_on(note, velocity);
        self.update_peak_active_voices();
    }

    fn note_off(&mut self, note: u8) {
        for voice in self
            .voices
            .iter_mut()
            .filter(|voice| voice.note == Some(note))
        {
            voice.voice.note_off(note);

            if voice.released_at.is_none() {
                self.release_sequence = self.release_sequence.saturating_add(1);
                voice.released_at = Some(self.release_sequence);
            }
        }
    }

    fn panic(&mut self) {
        for voice in self.voices.iter_mut() {
            voice.reset();
        }
    }

    fn compatible_with(&self, other: &InstrumentNode) -> bool {
        self.voices.len() == other.voices.len() && self.voice_config == other.voice_config
    }

    fn transfer_from(&mut self, old_node: &InstrumentNode) -> Result<(), StateTransferError> {
        if !old_node.compatible_with(self) {
            return Err(StateTransferError::IncompatibleInstrumentPool);
        }

        for (new_voice, old_voice) in self.voices.iter_mut().zip(old_node.voices.iter()) {
            new_voice.restore_state(old_voice.state());
        }

        self.allocation_sequence = old_node.allocation_sequence;
        self.release_sequence = old_node.release_sequence;
        self.peak_active_voices = old_node.peak_active_voices;
        Ok(())
    }

    fn select_voice_for_note_on(&self, note: u8) -> Option<usize> {
        self.voices
            .iter()
            .position(|voice| voice.note == Some(note))
            .or_else(|| self.voices.iter().position(InstrumentVoice::is_idle))
            .or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .filter_map(|(index, voice)| {
                        voice.released_at.map(|released_at| (index, released_at))
                    })
                    .min_by_key(|(_, released_at)| *released_at)
                    .map(|(index, _)| index)
            })
            .or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .filter(|(_, voice)| voice.note.is_some())
                    .min_by_key(|(_, voice)| voice.started_at)
                    .map(|(index, _)| index)
            })
    }

    fn active_voice_count(&self) -> u32 {
        self.voices
            .iter()
            .filter(|voice| voice.note.is_some() && voice.released_at.is_none())
            .count() as u32
    }

    fn update_peak_active_voices(&mut self) {
        self.peak_active_voices = self.peak_active_voices.max(self.active_voice_count());
    }

    fn diagnostics(&self) -> InstrumentDiagnostics {
        InstrumentDiagnostics {
            active_voices: self.active_voice_count(),
            peak_active_voices: self.peak_active_voices,
            voice_steals: self.voice_steals,
        }
    }
}

impl InstrumentVoice {
    fn new(
        attack_seconds: f32,
        decay_seconds: f32,
        sustain_level: f32,
        release_seconds: f32,
    ) -> Self {
        Self {
            voice: MonophonicVoice::new(
                attack_seconds,
                decay_seconds,
                sustain_level,
                release_seconds,
            ),
            note: None,
            started_at: 0,
            released_at: None,
        }
    }

    fn is_idle(&self) -> bool {
        self.note.is_none()
    }

    fn reset(&mut self) {
        self.voice.panic();
        self.note = None;
        self.released_at = None;
    }

    fn state(&self) -> InstrumentVoiceState {
        InstrumentVoiceState {
            voice: self.voice.state(),
            note: self.note,
            started_at: self.started_at,
            released_at: self.released_at,
        }
    }

    fn restore_state(&mut self, state: InstrumentVoiceState) {
        self.voice.restore_state(state.voice);
        self.note = state.note;
        self.started_at = state.started_at;
        self.released_at = state.released_at;
    }
}

impl MonoInstrumentNode {
    fn process(&mut self, context: &NodeProcessContext, buffers: &mut AudioBufferArena) {
        let output = buffers.slot_mut(self.output_buffer);

        for frame in context.range.start_frame..context.range.end_frame {
            output[frame] = self.voice.next_sample(context.sample_rate);
        }
    }

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        _emitter: &mut EventEmitter<'_>,
    ) -> bool {
        match *event {
            ScheduledEngineEvent::NoteOn { note, velocity, .. } => {
                self.voice.note_on(note, velocity);
                true
            }
            ScheduledEngineEvent::NoteOff { note, .. } => {
                self.voice.note_off(note);
                true
            }
            ScheduledEngineEvent::ArpeggiatorTick { .. } => false,
        }
    }
}

impl OscillatorNode {
    fn process(
        &mut self,
        context: &NodeProcessContext,
        buffers: &mut AudioBufferArena,
        parameters: &mut [RuntimeParameter],
    ) {
        let output = buffers.slot_mut(self.output_buffer);
        let frequency = &mut parameters[self.frequency_parameter].smoother;

        for frame in context.range.start_frame..context.range.end_frame {
            let frequency_hz = frequency.next_value();
            output[frame] = (self.phase * std::f64::consts::TAU).sin() as f32;
            self.phase += frequency_hz as f64 / context.sample_rate.max(1.0);
            self.phase -= self.phase.floor();
        }
    }
}

struct GainNode {
    gain_parameter: usize,
    input_buffer: usize,
    output_buffer: usize,
}

impl GainNode {
    fn process(
        &mut self,
        context: &NodeProcessContext,
        buffers: &mut AudioBufferArena,
        parameters: &mut [RuntimeParameter],
    ) {
        let gain = &mut parameters[self.gain_parameter].smoother;

        for frame in context.range.start_frame..context.range.end_frame {
            let sample = buffers.sample(self.input_buffer, 0, frame) * gain.next_value();

            buffers.set_sample(self.output_buffer, 0, frame, sample);
        }
    }
}

struct OutputNode {
    input_buffer: usize,
    output_channels: usize,
}

impl OutputNode {
    fn process(
        &mut self,
        context: &NodeProcessContext,
        buffers: &AudioBufferArena,
        output: &mut [f32],
    ) {
        let input = buffers.slot(self.input_buffer);
        let channels = context.output_channels.min(self.output_channels).max(1);

        for frame in context.range.start_frame..context.range.end_frame {
            let sample = input[frame];
            let frame_start = frame * context.output_channels;
            let frame_end = frame_start + channels;

            for output_sample in &mut output[frame_start..frame_end] {
                *output_sample = sample;
            }
        }
    }
}

struct RuntimeParameter {
    id: u32,
    default_value: f32,
    smoother: SmoothedParameter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PreparedEventRoute {
    destination_node_index: u32,
    destination_port_id: u16,
    event_mask: EventRouteMask,
    priority: u16,
}

impl PreparedEventRoute {
    fn accepts(&self, event: ScheduledEngineEvent) -> bool {
        match event {
            ScheduledEngineEvent::NoteOn { .. } | ScheduledEngineEvent::NoteOff { .. } => {
                self.event_mask.accepts_note()
            }
            ScheduledEngineEvent::ArpeggiatorTick { .. } => self.event_mask.accepts_tick(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RouteRange {
    start: u32,
    len: u32,
}

impl RouteRange {
    fn end(self) -> u32 {
        self.start.saturating_add(self.len)
    }
}

struct PreparedEventGraph {
    routes: Box<[PreparedEventRoute]>,
    source_endpoints: Box<[PreparedEventSourceEndpoint]>,
    source_ranges: Box<[RouteRange]>,
    source_node_indexes: Box<[Option<NodeId>]>,
}

impl PreparedEventGraph {
    fn prepare(plan: &NativeExecutionPlan) -> Result<Self, PlanValidationError> {
        let source_node_indexes = plan
            .nodes
            .iter()
            .map(|node| Some(node.id))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let mut prepared_routes = plan
            .event_routes
            .iter()
            .enumerate()
            .filter(|(_, route)| route.enabled)
            .map(|(plan_order, route)| {
                if !route.event_mask.accepts_any() {
                    return Err(PlanValidationError::InvalidEventRouteMask);
                }

                let source_node_index = node_index(plan, route.source.node_id)? as u32;
                let destination_node_index = node_index(plan, route.destination.node_id)? as u32;

                validate_event_endpoint(
                    plan,
                    route.source,
                    EventPortDirection::Output,
                    route.event_mask,
                    PlanValidationError::UnknownEventSourcePort,
                )?;
                validate_event_endpoint(
                    plan,
                    route.destination,
                    EventPortDirection::Input,
                    route.event_mask,
                    PlanValidationError::UnknownEventDestinationPort,
                )?;

                Ok(SortableEventRoute {
                    source_node_index,
                    source_port_id: route.source.port_id,
                    destination_node: route.destination.node_id,
                    destination_port_id: route.destination.port_id,
                    route: PreparedEventRoute {
                        destination_node_index,
                        destination_port_id: route.destination.port_id,
                        event_mask: route.event_mask,
                        priority: route.priority,
                    },
                    plan_order: plan_order as u32,
                })
            })
            .collect::<Result<Vec<_>, PlanValidationError>>()?;

        prepared_routes.sort_by_key(|route| {
            (
                route.source_node_index,
                route.source_port_id,
                route.route.priority,
                route.destination_node,
                route.destination_port_id,
                route.plan_order,
            )
        });

        let mut source_endpoints = Vec::new();
        let mut source_ranges = Vec::new();
        let mut routes = Vec::with_capacity(prepared_routes.len());
        let mut index = 0;

        while index < prepared_routes.len() {
            let source_node_index = prepared_routes[index].source_node_index;
            let source_port_id = prepared_routes[index].source_port_id;
            let start = routes.len() as u32;

            while index < prepared_routes.len()
                && prepared_routes[index].source_node_index == source_node_index
                && prepared_routes[index].source_port_id == source_port_id
            {
                routes.push(prepared_routes[index].route);
                index += 1;
            }

            source_endpoints.push(PreparedEventSourceEndpoint {
                node_index: source_node_index,
                port_id: source_port_id,
            });
            source_ranges.push(RouteRange {
                start,
                len: routes.len() as u32 - start,
            });
        }

        Ok(Self {
            routes: routes.into_boxed_slice(),
            source_endpoints: source_endpoints.into_boxed_slice(),
            source_ranges: source_ranges.into_boxed_slice(),
            source_node_indexes,
        })
    }

    fn source_node_index(&self, source_node: NodeId) -> Option<u32> {
        self.source_node_indexes
            .iter()
            .enumerate()
            .find_map(|(index, candidate)| {
                candidate
                    .is_some_and(|candidate| candidate == source_node)
                    .then_some(index as u32)
            })
    }

    fn source_endpoint_index(&self, source_node_index: u32, source_port_id: u16) -> Option<u32> {
        self.source_endpoints
            .iter()
            .enumerate()
            .find_map(|(index, endpoint)| {
                (endpoint.node_index == source_node_index && endpoint.port_id == source_port_id)
                    .then_some(index as u32)
            })
    }

    fn fallback_source_endpoint_index(&self, event: ScheduledEngineEvent) -> Option<u32> {
        self.source_ranges
            .iter()
            .enumerate()
            .find_map(|(index, range)| {
                self.routes[range.start as usize..range.end() as usize]
                    .iter()
                    .any(|route| route.accepts(event))
                    .then_some(index as u32)
            })
    }

    fn source_node_id(&self, source_node_index: u32) -> Option<NodeId> {
        self.source_node_indexes
            .get(source_node_index as usize)
            .copied()
            .flatten()
    }

    fn route_range(&self, source_endpoint_index: u32) -> RouteRange {
        self.source_ranges
            .get(source_endpoint_index as usize)
            .copied()
            .unwrap_or_default()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PreparedEventSourceEndpoint {
    node_index: u32,
    port_id: u16,
}

#[derive(Clone, Copy)]
struct SortableEventRoute {
    source_node_index: u32,
    source_port_id: u16,
    destination_node: NodeId,
    destination_port_id: u16,
    route: PreparedEventRoute,
    plan_order: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct EmittedRuntimeEvent {
    source_endpoint_index: u32,
    event: ScheduledEngineEvent,
    depth: u16,
}

struct FixedEventQueue {
    entries: Box<[Option<EmittedRuntimeEvent>]>,
    head: usize,
    len: usize,
}

impl Default for FixedEventQueue {
    fn default() -> Self {
        Self {
            entries: vec![None; MAX_EVENTS_PER_BLOCK].into_boxed_slice(),
            head: 0,
            len: 0,
        }
    }
}

impl FixedEventQueue {
    fn clear(&mut self) {
        self.entries.fill(None);
        self.head = 0;
        self.len = 0;
    }

    fn push(&mut self, event: EmittedRuntimeEvent) -> Result<(), EmittedRuntimeEvent> {
        if self.len >= self.entries.len() {
            return Err(event);
        }

        let index = (self.head + self.len) % self.entries.len();

        self.entries[index] = Some(event);
        self.len += 1;
        Ok(())
    }

    fn pop(&mut self) -> Option<EmittedRuntimeEvent> {
        if self.len == 0 {
            return None;
        }

        let event = self.entries[self.head].take();

        self.head = (self.head + 1) % self.entries.len();
        self.len -= 1;
        event
    }
}

struct FixedFutureEventQueue {
    entries: Box<[Option<FutureEventRequest>]>,
    head: usize,
    len: usize,
}

impl Default for FixedFutureEventQueue {
    fn default() -> Self {
        Self {
            entries: vec![None; MAX_FUTURE_EVENTS_PER_DISPATCH].into_boxed_slice(),
            head: 0,
            len: 0,
        }
    }
}

impl FixedFutureEventQueue {
    fn clear(&mut self) {
        self.entries.fill(None);
        self.head = 0;
        self.len = 0;
    }

    fn push(&mut self, request: FutureEventRequest) -> Result<(), FutureEventRequest> {
        if self.len >= self.entries.len() {
            return Err(request);
        }

        let index = (self.head + self.len) % self.entries.len();

        self.entries[index] = Some(request);
        self.len += 1;
        Ok(())
    }

    fn pop(&mut self) -> Option<FutureEventRequest> {
        if self.len == 0 {
            return None;
        }

        let request = self.entries[self.head].take();

        self.head = (self.head + 1) % self.entries.len();
        self.len -= 1;
        request
    }
}

#[allow(dead_code)]
struct EventEmitter<'a> {
    queue: &'a mut FixedEventQueue,
    event_graph: &'a PreparedEventGraph,
    source_node_index: u32,
    source_node_id: NodeId,
    parent_input_port: u16,
    parent_depth: u16,
    diagnostics: &'a mut EventGraphDiagnostics,
}

#[allow(dead_code)]
impl EventEmitter<'_> {
    fn suppress(&mut self) {
        self.diagnostics.events_suppressed = self.diagnostics.events_suppressed.saturating_add(1);
    }

    fn emit(&mut self, event: ScheduledEngineEvent) -> Result<(), ScheduledEngineEvent> {
        self.emit_from(DEFAULT_EVENT_PORT, event)
    }

    fn emit_from(
        &mut self,
        output_port: u16,
        event: ScheduledEngineEvent,
    ) -> Result<(), ScheduledEngineEvent> {
        if self.parent_depth >= MAX_EVENT_DEPTH {
            self.diagnostics.events_dropped_depth =
                self.diagnostics.events_dropped_depth.saturating_add(1);
            return Err(event);
        }

        let Some(source_endpoint_index) = self
            .event_graph
            .source_endpoint_index(self.source_node_index, output_port)
        else {
            self.diagnostics.events_emitted = self.diagnostics.events_emitted.saturating_add(1);
            return Ok(());
        };

        let runtime_event = EmittedRuntimeEvent {
            source_endpoint_index,
            event,
            depth: self.parent_depth + 1,
        };

        if self.queue.push(runtime_event).is_err() {
            self.diagnostics.events_dropped_capacity =
                self.diagnostics.events_dropped_capacity.saturating_add(1);
            return Err(event);
        }

        self.diagnostics.events_emitted = self.diagnostics.events_emitted.saturating_add(1);
        Ok(())
    }
}

struct FutureEventEmitter<'a> {
    queue: &'a mut FixedFutureEventQueue,
    plan_id: u64,
    plan_revision: u64,
    source_node_id: NodeId,
    current_sample: u64,
    tempo_map: TempoMapSnapshot,
    transport_loop: TransportLoop,
    diagnostics: &'a mut EventGraphDiagnostics,
}

impl FutureEventEmitter<'_> {
    fn request_from(
        &mut self,
        output_port: u16,
        event: ScheduledEngineEvent,
        at_sample: u64,
    ) -> Result<(), FutureEventRequest> {
        self.request_from_lifetime(
            output_port,
            event,
            at_sample,
            FutureEventLifetime::RevisionBound,
            0,
        )
    }

    fn request_from_lifetime(
        &mut self,
        output_port: u16,
        event: ScheduledEngineEvent,
        at_sample: u64,
        lifetime: FutureEventLifetime,
        generation: u64,
    ) -> Result<(), FutureEventRequest> {
        let owner = match lifetime {
            FutureEventLifetime::RevisionBound => FutureEventOwner::revision_bound(
                self.plan_id,
                self.plan_revision,
                self.source_node_id,
            ),
            FutureEventLifetime::GenerationBound => FutureEventOwner::generation_bound(
                self.plan_id,
                self.plan_revision,
                self.source_node_id,
                generation,
            ),
            FutureEventLifetime::CompletionRequired => FutureEventOwner::completion_required(
                self.plan_id,
                self.plan_revision,
                self.source_node_id,
            ),
        };

        if at_sample <= self.current_sample {
            self.diagnostics.future_events_rejected_late = self
                .diagnostics
                .future_events_rejected_late
                .saturating_add(1);
            return Err(FutureEventRequest {
                source: EventEndpoint {
                    node_id: self.source_node_id,
                    port_id: output_port,
                },
                event,
                at_sample,
                owner,
            });
        }

        let request = FutureEventRequest {
            source: EventEndpoint {
                node_id: self.source_node_id,
                port_id: output_port,
            },
            event: set_event_sample(event, at_sample),
            at_sample,
            owner,
        };

        if self.queue.push(request).is_err() {
            self.diagnostics.future_events_dropped_capacity = self
                .diagnostics
                .future_events_dropped_capacity
                .saturating_add(1);
            return Err(request);
        }

        self.diagnostics.future_events_requested =
            self.diagnostics.future_events_requested.saturating_add(1);
        Ok(())
    }

    fn source_node_id(&self) -> NodeId {
        self.source_node_id
    }
}

fn event_endpoint_for_event(event: ScheduledEngineEvent) -> EventEndpoint {
    match event {
        ScheduledEngineEvent::NoteOn { target_node, .. }
        | ScheduledEngineEvent::NoteOff { target_node, .. }
        | ScheduledEngineEvent::ArpeggiatorTick { target_node, .. } => EventEndpoint {
            node_id: target_node,
            port_id: DEFAULT_EVENT_PORT,
        },
    }
}

fn set_event_sample(event: ScheduledEngineEvent, at_sample: u64) -> ScheduledEngineEvent {
    match event {
        ScheduledEngineEvent::NoteOn {
            target_node,
            note,
            velocity,
            ..
        } => ScheduledEngineEvent::NoteOn {
            target_node,
            note,
            velocity,
            at_sample,
        },
        ScheduledEngineEvent::NoteOff {
            target_node, note, ..
        } => ScheduledEngineEvent::NoteOff {
            target_node,
            note,
            at_sample,
        },
        ScheduledEngineEvent::ArpeggiatorTick {
            target_node,
            generation,
            ..
        } => ScheduledEngineEvent::ArpeggiatorTick {
            target_node,
            generation,
            at_sample,
        },
    }
}

fn add_event_graph_diagnostics(total: &mut EventGraphDiagnostics, delta: EventGraphDiagnostics) {
    total.events_received = total.events_received.saturating_add(delta.events_received);
    total.route_dispatches = total
        .route_dispatches
        .saturating_add(delta.route_dispatches);
    total.events_emitted = total.events_emitted.saturating_add(delta.events_emitted);
    total.events_suppressed = total
        .events_suppressed
        .saturating_add(delta.events_suppressed);
    total.events_dropped_capacity = total
        .events_dropped_capacity
        .saturating_add(delta.events_dropped_capacity);
    total.events_dropped_depth = total
        .events_dropped_depth
        .saturating_add(delta.events_dropped_depth);
    total.events_dropped_budget = total
        .events_dropped_budget
        .saturating_add(delta.events_dropped_budget);
    total.future_events_requested = total
        .future_events_requested
        .saturating_add(delta.future_events_requested);
    total.future_events_rejected_late = total
        .future_events_rejected_late
        .saturating_add(delta.future_events_rejected_late);
    total.future_events_dropped_capacity = total
        .future_events_dropped_capacity
        .saturating_add(delta.future_events_dropped_capacity);
    total.future_events_dropped_scheduler_full = total
        .future_events_dropped_scheduler_full
        .saturating_add(delta.future_events_dropped_scheduler_full);
    total.future_events_discarded_plan_revision = total
        .future_events_discarded_plan_revision
        .saturating_add(delta.future_events_discarded_plan_revision);
    total.future_events_discarded_generation = total
        .future_events_discarded_generation
        .saturating_add(delta.future_events_discarded_generation);
}

#[cfg(test)]
struct ForwardingNode;

#[cfg(test)]
impl ForwardingNode {
    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        emitter.emit(*event).is_ok()
    }
}

#[cfg(test)]
struct BurstNode {
    events_per_input: usize,
}

#[cfg(test)]
impl BurstNode {
    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        let mut emitted = false;

        for _ in 0..self.events_per_input {
            emitted |= emitter.emit(*event).is_ok();
        }

        emitted
    }
}

#[cfg(test)]
#[derive(Default)]
struct RecordingNode {
    events: Vec<ScheduledEngineEvent>,
}

#[cfg(test)]
impl RecordingNode {
    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        _emitter: &mut EventEmitter<'_>,
    ) -> bool {
        self.events.push(*event);
        true
    }
}

fn process_nodes(
    nodes: &mut [RuntimeNode],
    buffers: &mut AudioBufferArena,
    parameters: &mut [RuntimeParameter],
    execution_order: &[usize],
    output: &mut [f32],
    sample_rate: f64,
    output_channels: usize,
    range: ProcessRange,
) {
    let context = NodeProcessContext {
        sample_rate,
        output_channels,
        range,
    };

    for node_index in execution_order.iter().copied() {
        let node = &mut nodes[node_index];

        node.process(&context, buffers, parameters, output);
    }
}

pub struct AudioBufferArena {
    samples: Box<[f32]>,
    slots: Box<[ResolvedBufferSlot]>,
    maximum_frames: usize,
}

impl AudioBufferArena {
    fn new(slots: &[AudioBufferSlot], maximum_frames: usize) -> Result<Self, PlanValidationError> {
        let mut resolved_slots = Vec::with_capacity(slots.len());
        let mut offset = 0;

        for slot in slots {
            if slot.channels == 0 {
                return Err(PlanValidationError::ChannelMismatch);
            }

            resolved_slots.push(ResolvedBufferSlot {
                offset,
                channels: slot.channels as usize,
            });
            offset += slot.channels as usize * maximum_frames;
        }

        Ok(Self {
            samples: vec![0.0; offset].into_boxed_slice(),
            slots: resolved_slots.into_boxed_slice(),
            maximum_frames,
        })
    }

    fn clear_range(&mut self, range: ProcessRange) {
        for slot_index in 0..self.slots.len() {
            let slot = self.slots[slot_index];

            for channel in 0..slot.channels {
                let start = slot.offset + channel * self.maximum_frames + range.start_frame;
                let end = slot.offset + channel * self.maximum_frames + range.end_frame;

                self.samples[start..end].fill(0.0);
            }
        }
    }

    fn slot(&self, index: usize) -> &[f32] {
        let slot = self.slots[index];
        &self.samples[slot.offset..slot.offset + self.maximum_frames]
    }

    fn slot_mut(&mut self, index: usize) -> &mut [f32] {
        let slot = self.slots[index];
        &mut self.samples[slot.offset..slot.offset + self.maximum_frames]
    }

    fn sample(&self, index: usize, channel: usize, frame: usize) -> f32 {
        let slot = self.slots[index];

        self.samples[slot.offset + channel * self.maximum_frames + frame]
    }

    fn set_sample(&mut self, index: usize, channel: usize, frame: usize, sample: f32) {
        let slot = self.slots[index];

        self.samples[slot.offset + channel * self.maximum_frames + frame] = sample;
    }
}

#[derive(Clone, Copy)]
struct ResolvedBufferSlot {
    offset: usize,
    channels: usize,
}

fn validate_unique_node_ids(plan: &NativeExecutionPlan) -> Result<(), PlanValidationError> {
    for (index, node) in plan.nodes.iter().enumerate() {
        if plan
            .nodes
            .iter()
            .skip(index + 1)
            .any(|candidate| candidate.id == node.id)
        {
            return Err(PlanValidationError::DuplicateNodeId);
        }
    }

    Ok(())
}

fn validate_event_port_declarations(plan: &NativeExecutionPlan) -> Result<(), PlanValidationError> {
    for node in &plan.nodes {
        let ports = event_ports_for_node(&node.kind);

        for (index, port) in ports.iter().enumerate() {
            if ports
                .iter()
                .skip(index + 1)
                .any(|candidate| candidate.id == port.id && candidate.direction == port.direction)
            {
                return Err(PlanValidationError::DuplicateEventPort);
            }
        }
    }

    Ok(())
}

fn event_ports_for_node(kind: &PlanNodeKind) -> &'static [EventPortMetadata] {
    match kind {
        PlanNodeKind::EventSplitter(_) => &EVENT_SPLITTER_PORTS,
        PlanNodeKind::EventDelay(_) => &EVENT_DELAY_PORTS,
        PlanNodeKind::Arpeggiator(_) => &ARPEGGIATOR_EVENT_PORTS,
        PlanNodeKind::Scale(_) => &SCALE_EVENT_PORTS,
        _ => &DEFAULT_EVENT_PORTS,
    }
}

fn validate_event_endpoint(
    plan: &NativeExecutionPlan,
    endpoint: EventEndpoint,
    required_direction: EventPortDirection,
    event_mask: EventRouteMask,
    unknown_port_error: PlanValidationError,
) -> Result<(), PlanValidationError> {
    let node = plan
        .nodes
        .iter()
        .find(|node| node.id == endpoint.node_id)
        .ok_or(PlanValidationError::UnknownNode)?;
    let ports = event_ports_for_node(&node.kind);

    if !ports.iter().any(|port| port.id == endpoint.port_id) {
        return Err(unknown_port_error);
    }

    let Some(port) = ports
        .iter()
        .find(|port| port.id == endpoint.port_id && port.direction == required_direction)
    else {
        return Err(PlanValidationError::IncompatibleEventRoute);
    };

    if event_mask.accepts_note() && !port.mask.accepts_note() {
        return Err(PlanValidationError::IncompatibleEventRoute);
    }

    if event_mask.accepts_tick() && !port.mask.accepts_tick() {
        return Err(PlanValidationError::IncompatibleEventRoute);
    }

    Ok(())
}

fn node_index(plan: &NativeExecutionPlan, node_id: NodeId) -> Result<usize, PlanValidationError> {
    plan.nodes
        .iter()
        .position(|node| node.id == node_id)
        .ok_or(PlanValidationError::UnknownNode)
}

fn buffer_index(
    plan: &NativeExecutionPlan,
    buffer_id: BufferSlotId,
) -> Result<usize, PlanValidationError> {
    plan.buffers
        .iter()
        .position(|buffer| buffer.id == buffer_id)
        .ok_or(PlanValidationError::UnknownBuffer)
}

fn parameter_index(
    plan: &NativeExecutionPlan,
    parameter_id: ParameterSlotId,
) -> Result<usize, PlanValidationError> {
    plan.parameters
        .iter()
        .position(|parameter| parameter.id == parameter_id)
        .ok_or(PlanValidationError::UnknownParameter)
}

fn buffer_channels(
    plan: &NativeExecutionPlan,
    buffer_id: BufferSlotId,
) -> Result<u16, PlanValidationError> {
    plan.buffers
        .iter()
        .find(|buffer| buffer.id == buffer_id)
        .map(|buffer| buffer.channels)
        .ok_or(PlanValidationError::UnknownBuffer)
}

fn require_channels(
    plan: &NativeExecutionPlan,
    buffer_id: BufferSlotId,
    channels: u16,
) -> Result<(), PlanValidationError> {
    if buffer_channels(plan, buffer_id)? != channels {
        return Err(PlanValidationError::ChannelMismatch);
    }

    Ok(())
}

fn prepare_chord_intervals(intervals: &[i8]) -> Result<Box<[i8]>, PlanValidationError> {
    if intervals.is_empty() || intervals.len() > MAX_CHORD_INTERVALS {
        return Err(PlanValidationError::InvalidChordIntervals);
    }

    for (index, interval) in intervals.iter().enumerate() {
        if intervals
            .iter()
            .skip(index + 1)
            .any(|candidate| candidate == interval)
        {
            return Err(PlanValidationError::DuplicateChordInterval);
        }
    }

    Ok(intervals.to_vec().into_boxed_slice())
}

fn validate_velocity_transform(
    multiplier: f32,
    offset: f32,
    minimum: f32,
    maximum: f32,
) -> Result<(), PlanValidationError> {
    if !multiplier.is_finite()
        || !offset.is_finite()
        || !minimum.is_finite()
        || !maximum.is_finite()
        || multiplier < 0.0
        || !(0.0..=1.0).contains(&minimum)
        || !(0.0..=1.0).contains(&maximum)
        || minimum > maximum
    {
        return Err(PlanValidationError::InvalidVelocityTransform);
    }

    Ok(())
}

fn validate_instrument_voice_count(voice_count: u16) -> Result<(), PlanValidationError> {
    if voice_count == 0 || voice_count > MAX_INSTRUMENT_VOICES {
        return Err(PlanValidationError::InvalidInstrumentVoiceCount);
    }

    Ok(())
}

fn validate_arpeggiator_config(
    step_beats: f64,
    gate_ratio: f32,
    maximum_held_notes: u16,
    octave_count: u8,
) -> Result<(), PlanValidationError> {
    if !step_beats.is_finite()
        || step_beats <= 0.0
        || !gate_ratio.is_finite()
        || gate_ratio <= 0.0
        || gate_ratio >= 1.0
        || maximum_held_notes == 0
        || maximum_held_notes > MAX_ARPEGGIATOR_HELD_NOTES
        || octave_count == 0
    {
        return Err(PlanValidationError::InvalidArpeggiatorConfig);
    }

    Ok(())
}

fn validate_voice_config(config: VoiceConfig) -> Result<(), PlanValidationError> {
    if !config.attack_seconds.is_finite()
        || !config.decay_seconds.is_finite()
        || !config.sustain_level.is_finite()
        || !config.release_seconds.is_finite()
    {
        return Err(PlanValidationError::InvalidInstrumentVoiceConfig);
    }

    Ok(())
}

fn runtime_node_kind(kind: &PlanNodeKind) -> Result<RuntimeNodeKind, PlanValidationError> {
    match kind {
        PlanNodeKind::EventInput(_) => Ok(RuntimeNodeKind::EventInput),
        PlanNodeKind::EventSplitter(_) => Ok(RuntimeNodeKind::EventSplitter),
        PlanNodeKind::EventDelay(_) => Ok(RuntimeNodeKind::EventDelay),
        PlanNodeKind::Arpeggiator(_) => Ok(RuntimeNodeKind::Arpeggiator),
        PlanNodeKind::Oscillator(_) => Ok(RuntimeNodeKind::Oscillator),
        PlanNodeKind::Transpose(_) => Ok(RuntimeNodeKind::Transpose),
        PlanNodeKind::Scale(_) => Ok(RuntimeNodeKind::Scale),
        PlanNodeKind::Velocity(_) => Ok(RuntimeNodeKind::Velocity),
        PlanNodeKind::Chord(_) => Ok(RuntimeNodeKind::Chord),
        PlanNodeKind::Instrument(_) => Ok(RuntimeNodeKind::Instrument),
        PlanNodeKind::Voice(_) => Ok(RuntimeNodeKind::Voice),
        PlanNodeKind::Gain(_) => Ok(RuntimeNodeKind::Gain),
        PlanNodeKind::Output(_) => Ok(RuntimeNodeKind::Output),
        PlanNodeKind::Unsupported { .. } => Err(PlanValidationError::UnsupportedNodeType),
    }
}

fn instrument_runtime_metadata(kind: &PlanNodeKind) -> Option<InstrumentRuntimeMetadata> {
    match kind {
        PlanNodeKind::Instrument(node) => Some(InstrumentRuntimeMetadata {
            voice_count: node.voice_count,
            voice_config: VoiceConfig {
                attack_seconds: node.attack_seconds,
                decay_seconds: node.decay_seconds,
                sustain_level: node.sustain_level,
                release_seconds: node.release_seconds,
            },
        }),
        _ => None,
    }
}

fn initial_arpeggiator_random_state(seed: u64) -> u64 {
    let state = mix_arpeggiator_random(seed);

    if state == 0 {
        0x9e37_79b9_7f4a_7c15
    } else {
        state
    }
}

fn next_arpeggiator_random_state(mut state: u64) -> u64 {
    if state == 0 {
        state = 0x9e37_79b9_7f4a_7c15;
    }

    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    state
}

fn random_index_from_seed(seed: u64, step_index: u64, candidate_count: usize) -> usize {
    let value = mix_arpeggiator_random(seed ^ step_index.wrapping_mul(0x9e37_79b9_7f4a_7c15));

    (value % candidate_count as u64) as usize
}

fn mix_arpeggiator_random(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn arpeggiator_compatibility(kind: &PlanNodeKind) -> Option<ArpeggiatorCompatibility> {
    match kind {
        PlanNodeKind::Arpeggiator(node) => Some(ArpeggiatorCompatibility {
            step_beats: node.step_beats,
            gate_ratio: node.gate_ratio,
            phase_mode: node.phase_mode,
            pattern: node.pattern,
            maximum_held_notes: node.maximum_held_notes,
            octave_count: node.octave_count,
            octave_direction: node.octave_direction,
            random_seed: node.random_seed,
        }),
        _ => None,
    }
}

fn reject_duplicate_stable_ids(
    nodes: &[RuntimeNodeMetadata],
    error: StateTransferPlanningError,
) -> Result<(), StateTransferPlanningError> {
    for (index, node) in nodes.iter().enumerate() {
        if nodes
            .iter()
            .skip(index + 1)
            .any(|candidate| candidate.stable_id == node.stable_id)
        {
            return Err(error);
        }
    }

    Ok(())
}

fn state_transfer_kind_for_node(node_kind: RuntimeNodeKind) -> Option<StateTransferKind> {
    match node_kind {
        RuntimeNodeKind::EventInput => None,
        RuntimeNodeKind::EventSplitter => None,
        RuntimeNodeKind::EventDelay => None,
        RuntimeNodeKind::Arpeggiator => Some(StateTransferKind::Arpeggiator),
        RuntimeNodeKind::Oscillator => Some(StateTransferKind::OscillatorPhase),
        RuntimeNodeKind::Transpose => None,
        RuntimeNodeKind::Scale => None,
        RuntimeNodeKind::Velocity => None,
        RuntimeNodeKind::Chord => None,
        RuntimeNodeKind::Instrument => Some(StateTransferKind::InstrumentPool),
        RuntimeNodeKind::Voice => None,
        RuntimeNodeKind::Gain => Some(StateTransferKind::GainSmoother),
        RuntimeNodeKind::Output => None,
    }
}

fn validate_state_transfer(
    old_plan: &PreparedExecutionPlan,
    new_plan: &PreparedExecutionPlan,
    transfer: &PlanStateTransfer,
) -> Result<(), StateTransferError> {
    for (index, entry) in transfer.entries.iter().enumerate() {
        if transfer
            .entries
            .iter()
            .skip(index + 1)
            .any(|candidate| candidate.old_node_index == entry.old_node_index)
        {
            return Err(StateTransferError::DuplicateOldNode);
        }

        if transfer
            .entries
            .iter()
            .skip(index + 1)
            .any(|candidate| candidate.new_node_index == entry.new_node_index)
        {
            return Err(StateTransferError::DuplicateNewNode);
        }
    }

    for entry in transfer.entries.iter().copied() {
        let old_node = old_plan
            .nodes
            .get(entry.old_node_index as usize)
            .ok_or(StateTransferError::UnknownOldNode)?;
        let new_node = new_plan
            .nodes
            .get(entry.new_node_index as usize)
            .ok_or(StateTransferError::UnknownNewNode)?;

        if old_node.node_type() != new_node.node_type() {
            return Err(StateTransferError::NodeTypeMismatch);
        }

        match (entry.kind, old_node.node_type()) {
            (StateTransferKind::OscillatorPhase, RuntimeNodeKind::Oscillator)
            | (StateTransferKind::GainSmoother, RuntimeNodeKind::Gain) => {}
            (StateTransferKind::Arpeggiator, RuntimeNodeKind::Arpeggiator) => {
                if !old_node.arpeggiator_compatible_with(new_node) {
                    return Err(StateTransferError::IncompatibleArpeggiator);
                }
            }
            (StateTransferKind::InstrumentPool, RuntimeNodeKind::Instrument) => {
                if !old_node.instrument_pool_compatible_with(new_node) {
                    return Err(StateTransferError::IncompatibleInstrumentPool);
                }
            }
            _ => return Err(StateTransferError::IncompatibleTransferKind),
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_protocol::{
        chorded_instrument_plan, diagnostic_tone_plan, event_endpoint, monophonic_instrument_plan,
        monophonic_voice_plan, transposed_monophonic_voice_plan, ArpeggiatorNodePlan,
        AudioBufferSlot, ChordNodePlan, EventDelayNodePlan, EventInputNodePlan, EventRoute,
        EventRouteMask, EventSplitterNodePlan, FutureEventOwner, GainNodePlan, InstrumentNodePlan,
        NativeExecutionPlan, OscillatorNodePlan, OutputNodePlan, PlanNode, PlanNodeKind,
        ScaleNodePlan, ScheduledEngineEvent, TransposeNodePlan, VelocityNodePlan,
        ARPEGGIATOR_PORT_NOTES, ARPEGGIATOR_PORT_TICK, ARPEGGIATOR_PORT_TICK_INPUT,
        DEFAULT_EVENT_PORT, EVENT_DELAY_PORT_DELAYED, NODE_ARPEGGIATOR, NODE_CHORD,
        NODE_EVENT_DELAY, NODE_EVENT_INPUT, NODE_EVENT_SPLITTER, NODE_GAIN, NODE_INSTRUMENT,
        NODE_OSCILLATOR, NODE_OUTPUT, NODE_SCALE, NODE_TRANSPOSE, NODE_VELOCITY, NODE_VOICE,
        PARAM_GAIN_GAIN, PARAM_OSCILLATOR_FREQUENCY, SCALE_PORT_ACCEPTED, SCALE_PORT_REJECTED,
    };

    #[test]
    fn prepares_valid_diagnostic_plan() {
        let plan = diagnostic_tone_plan(440.0, 0.05, 2);
        let prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert_eq!(prepared.output_node_count(), 1);
    }

    #[test]
    fn runtime_compiler_compiles_prepared_execution_plans() {
        let plan = diagnostic_tone_plan(440.0, 0.05, 2);
        let compiler = RuntimeCompiler::new(128);
        let prepared = compiler.compile(&plan).unwrap();

        assert_eq!(prepared.output_node_count(), 1);
    }

    #[test]
    fn compiles_instrument_as_event_consuming_audio_producer() {
        let plan = monophonic_instrument_plan(2);
        let prepared = RuntimeCompiler::new(128).compile(&plan).unwrap();
        let metadata = prepared.metadata();

        assert_eq!(metadata.nodes[0].stable_id, NODE_EVENT_INPUT as u64);
        assert_eq!(metadata.nodes[0].node_kind, RuntimeNodeKind::EventInput);
        assert_eq!(metadata.nodes[1].stable_id, NODE_INSTRUMENT as u64);
        assert_eq!(metadata.nodes[1].node_kind, RuntimeNodeKind::Instrument);
        assert_eq!(
            prepared.event_route_range_for_source(NODE_EVENT_INPUT),
            Some((0, 1))
        );
    }

    fn instrument_plan_with_voice_count(voice_count: u16) -> NativeExecutionPlan {
        let mut plan = monophonic_instrument_plan(2);

        if let Some(PlanNodeKind::Instrument(node)) = plan
            .nodes
            .iter_mut()
            .find(|node| node.id == NODE_INSTRUMENT)
            .map(|node| &mut node.kind)
        {
            node.voice_count = voice_count;
        }

        plan
    }

    fn instrument_diagnostics(prepared: &PreparedExecutionPlan) -> InstrumentDiagnostics {
        prepared
            .instrument_diagnostics(NODE_INSTRUMENT)
            .expect("instrument diagnostics should exist")
    }

    fn instrument_node(prepared: &PreparedExecutionPlan) -> &InstrumentNode {
        prepared
            .nodes
            .iter()
            .find_map(|node| match node {
                RuntimeNode::Instrument(node) => Some(node),
                _ => None,
            })
            .expect("instrument node should exist")
    }

    fn set_instrument_release(plan: &mut NativeExecutionPlan, release_seconds: f32) {
        if let Some(PlanNodeKind::Instrument(node)) = plan
            .nodes
            .iter_mut()
            .find(|node| node.id == NODE_INSTRUMENT)
            .map(|node| &mut node.kind)
        {
            node.release_seconds = release_seconds;
        }
    }

    #[test]
    fn instrument_one_note_uses_one_voice() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert_eq!(
            instrument_diagnostics(&prepared),
            InstrumentDiagnostics {
                active_voices: 1,
                peak_active_voices: 1,
                voice_steals: 0,
            }
        );
    }

    #[test]
    fn instrument_accepts_note_from_unknown_compatible_event_source() {
        const UNKNOWN_BRIDGE_SOURCE_NODE: u32 = 999_001;

        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(UNKNOWN_BRIDGE_SOURCE_NODE, 60, 0.5, 0,)));
        assert_eq!(instrument_diagnostics(&prepared).active_voices, 1);
        assert_eq!(
            prepared.event_graph_diagnostics(),
            EventGraphDiagnostics {
                events_received: 1,
                route_dispatches: 1,
                ..EventGraphDiagnostics::default()
            }
        );
    }

    #[test]
    fn instrument_simultaneous_notes_occupy_different_voices() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 0)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 2);
        assert_eq!(instrument_diagnostics(&prepared).voice_steals, 0);
    }

    #[test]
    fn instrument_note_off_releases_correct_voice() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 0)));
        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 60, 0)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 1);
        assert_eq!(instrument_diagnostics(&prepared).peak_active_voices, 2);
    }

    #[test]
    fn instrument_non_active_note_off_changes_nothing() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 61, 0)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 1);
    }

    #[test]
    fn instrument_repeated_same_note_retriggers_existing_voice() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.7, 0)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 1);
        assert_eq!(instrument_diagnostics(&prepared).voice_steals, 0);
    }

    #[test]
    fn instrument_released_voices_are_reused_before_active_stealing() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(2), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 0)));
        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 60, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 67, 0.5, 0)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 2);
        assert_eq!(instrument_diagnostics(&prepared).voice_steals, 0);
    }

    #[test]
    fn instrument_oldest_active_voice_is_stolen_deterministically() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(2), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 67, 0.5, 0)));
        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 60, 0)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 2);
        assert_eq!(instrument_diagnostics(&prepared).voice_steals, 1);
    }

    #[test]
    fn instrument_reset_clears_all_voices() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 0)));
        prepared.reset();

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 0);
    }

    #[test]
    fn rejects_invalid_instrument_voice_count() {
        let mut plan = instrument_plan_with_voice_count(0);

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::InvalidInstrumentVoiceCount)
        ));

        if let Some(PlanNodeKind::Instrument(node)) = plan
            .nodes
            .iter_mut()
            .find(|node| node.id == NODE_INSTRUMENT)
            .map(|node| &mut node.kind)
        {
            node.voice_count = MAX_INSTRUMENT_VOICES + 1;
        }

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::InvalidInstrumentVoiceCount)
        ));
    }

    #[test]
    fn rejects_non_finite_instrument_voice_configuration() {
        let mut plan = instrument_plan_with_voice_count(1);

        if let Some(PlanNodeKind::Instrument(node)) = plan
            .nodes
            .iter_mut()
            .find(|node| node.id == NODE_INSTRUMENT)
            .map(|node| &mut node.kind)
        {
            *node = InstrumentNodePlan {
                output_buffer: node.output_buffer,
                voice_count: node.voice_count,
                attack_seconds: f32::NAN,
                decay_seconds: node.decay_seconds,
                sustain_level: node.sustain_level,
                release_seconds: node.release_seconds,
            };
        }

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::InvalidInstrumentVoiceConfig)
        ));
    }

    fn note_on_from(source_node: u32) -> ScheduledEngineEvent {
        ScheduledEngineEvent::NoteOn {
            target_node: source_node,
            note: 69,
            velocity: 0.5,
            at_sample: 0,
        }
    }

    fn plan_with_forwardable_event_nodes() -> NativeExecutionPlan {
        let mut plan = monophonic_voice_plan(2);

        plan.nodes.insert(
            0,
            PlanNode {
                id: NODE_OSCILLATOR,
                kind: PlanNodeKind::Oscillator(OscillatorNodePlan {
                    frequency_parameter: 1,
                    output_buffer: 1,
                }),
            },
        );
        plan.nodes.insert(
            1,
            PlanNode {
                id: NODE_GAIN,
                kind: PlanNodeKind::Gain(GainNodePlan {
                    gain_parameter: PARAM_GAIN_GAIN,
                    input_buffer: 1,
                    output_buffer: 1,
                }),
            },
        );
        plan.parameters.push(engine_protocol::ParameterSlot {
            id: PARAM_OSCILLATOR_FREQUENCY,
            node: NODE_OSCILLATOR,
            parameter: PARAM_OSCILLATOR_FREQUENCY,
            default_value: 440.0,
        });
        plan.parameters.push(engine_protocol::ParameterSlot {
            id: PARAM_GAIN_GAIN,
            node: NODE_GAIN,
            parameter: PARAM_GAIN_GAIN,
            default_value: 1.0,
        });
        plan.audio_execution_order = vec![NODE_VOICE, NODE_OUTPUT];
        plan.event_routes.clear();
        plan
    }

    fn transpose_to_recording_plan(semitones: i8) -> NativeExecutionPlan {
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
                    kind: PlanNodeKind::Voice(engine_protocol::VoiceNodePlan {
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
                        output_channels: 2,
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

    fn scale_to_recording_plan(root_note: u8, pitch_class_mask: u16) -> NativeExecutionPlan {
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
                    kind: PlanNodeKind::Voice(engine_protocol::VoiceNodePlan {
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
                        output_channels: 2,
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

    fn chord_to_recording_plan(intervals: Vec<i8>) -> NativeExecutionPlan {
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
                    id: NODE_VOICE,
                    kind: PlanNodeKind::Voice(engine_protocol::VoiceNodePlan {
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
                        output_channels: 2,
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
                    destination: event_endpoint(NODE_VOICE),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
            ],
            audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
        }
    }

    fn velocity_to_recording_plan(velocity: VelocityNodePlan) -> NativeExecutionPlan {
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
                    id: NODE_VELOCITY,
                    kind: PlanNodeKind::Velocity(velocity),
                },
                PlanNode {
                    id: NODE_VOICE,
                    kind: PlanNodeKind::Voice(engine_protocol::VoiceNodePlan {
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
                        output_channels: 2,
                    }),
                },
            ],
            buffers: vec![AudioBufferSlot { id: 1, channels: 1 }],
            parameters: vec![],
            event_routes: vec![
                EventRoute {
                    source: event_endpoint(NODE_EVENT_INPUT),
                    destination: event_endpoint(NODE_VELOCITY),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
                EventRoute {
                    source: event_endpoint(NODE_VELOCITY),
                    destination: event_endpoint(NODE_VOICE),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
            ],
            audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
        }
    }

    fn splitter_to_recording_plan() -> NativeExecutionPlan {
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
                    id: NODE_EVENT_SPLITTER,
                    kind: PlanNodeKind::EventSplitter(EventSplitterNodePlan),
                },
                PlanNode {
                    id: NODE_VOICE,
                    kind: PlanNodeKind::Voice(engine_protocol::VoiceNodePlan {
                        output_buffer: 1,
                        attack_seconds: 0.0,
                        decay_seconds: 0.0,
                        sustain_level: 1.0,
                        release_seconds: 0.0,
                    }),
                },
                PlanNode {
                    id: NODE_INSTRUMENT,
                    kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                        output_buffer: 1,
                        voice_count: 4,
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
                        output_channels: 2,
                    }),
                },
            ],
            buffers: vec![AudioBufferSlot { id: 1, channels: 1 }],
            parameters: vec![],
            event_routes: vec![
                EventRoute {
                    source: event_endpoint(NODE_EVENT_INPUT),
                    destination: event_endpoint(NODE_EVENT_SPLITTER),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
                EventRoute {
                    source: EventEndpoint {
                        node_id: NODE_EVENT_SPLITTER,
                        port_id: EventSplitterNode::OUTPUT_A,
                    },
                    destination: event_endpoint(NODE_VOICE),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
                EventRoute {
                    source: EventEndpoint {
                        node_id: NODE_EVENT_SPLITTER,
                        port_id: EventSplitterNode::OUTPUT_B,
                    },
                    destination: event_endpoint(NODE_INSTRUMENT),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
            ],
            audio_execution_order: vec![NODE_OUTPUT],
        }
    }

    fn event_delay_to_recording_plan(delay_samples: u32) -> NativeExecutionPlan {
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
                    id: NODE_EVENT_DELAY,
                    kind: PlanNodeKind::EventDelay(EventDelayNodePlan { delay_samples }),
                },
                PlanNode {
                    id: NODE_VOICE,
                    kind: PlanNodeKind::Voice(engine_protocol::VoiceNodePlan {
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
                        output_channels: 2,
                    }),
                },
            ],
            buffers: vec![AudioBufferSlot { id: 1, channels: 1 }],
            parameters: vec![],
            event_routes: vec![
                EventRoute {
                    source: event_endpoint(NODE_EVENT_INPUT),
                    destination: event_endpoint(NODE_EVENT_DELAY),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
                EventRoute {
                    source: EventEndpoint {
                        node_id: NODE_EVENT_DELAY,
                        port_id: EVENT_DELAY_PORT_DELAYED,
                    },
                    destination: event_endpoint(NODE_VOICE),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
            ],
            audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
        }
    }

    fn arpeggiator_to_recording_plan(
        step_beats: f64,
        gate_ratio: f32,
        maximum_held_notes: u16,
    ) -> NativeExecutionPlan {
        arpeggiator_to_recording_plan_with_pattern(
            step_beats,
            gate_ratio,
            maximum_held_notes,
            ArpeggiatorPattern::Ascending,
        )
    }

    fn arpeggiator_to_recording_plan_with_pattern(
        step_beats: f64,
        gate_ratio: f32,
        maximum_held_notes: u16,
        pattern: ArpeggiatorPattern,
    ) -> NativeExecutionPlan {
        arpeggiator_to_recording_plan_with_pattern_and_octaves(
            step_beats,
            gate_ratio,
            maximum_held_notes,
            pattern,
            1,
            ArpeggiatorOctaveDirection::Up,
        )
    }

    fn arpeggiator_to_recording_plan_with_pattern_and_octaves(
        step_beats: f64,
        gate_ratio: f32,
        maximum_held_notes: u16,
        pattern: ArpeggiatorPattern,
        octave_count: u8,
        octave_direction: ArpeggiatorOctaveDirection,
    ) -> NativeExecutionPlan {
        arpeggiator_to_recording_plan_with_pattern_octaves_and_seed(
            step_beats,
            gate_ratio,
            maximum_held_notes,
            pattern,
            octave_count,
            octave_direction,
            1,
        )
    }

    fn arpeggiator_to_recording_plan_with_pattern_octaves_and_seed(
        step_beats: f64,
        gate_ratio: f32,
        maximum_held_notes: u16,
        pattern: ArpeggiatorPattern,
        octave_count: u8,
        octave_direction: ArpeggiatorOctaveDirection,
        random_seed: u64,
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
                    id: NODE_ARPEGGIATOR,
                    kind: PlanNodeKind::Arpeggiator(ArpeggiatorNodePlan {
                        step_beats,
                        gate_ratio,
                        maximum_held_notes,
                        phase_mode: ArpeggiatorPhaseMode::FreeRunning,
                        pattern,
                        octave_count,
                        octave_direction,
                        random_seed,
                    }),
                },
                PlanNode {
                    id: NODE_VOICE,
                    kind: PlanNodeKind::Voice(engine_protocol::VoiceNodePlan {
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
                        output_channels: 2,
                    }),
                },
            ],
            buffers: vec![AudioBufferSlot { id: 1, channels: 1 }],
            parameters: vec![],
            event_routes: vec![
                EventRoute {
                    source: event_endpoint(NODE_EVENT_INPUT),
                    destination: event_endpoint(NODE_ARPEGGIATOR),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
                EventRoute {
                    source: EventEndpoint {
                        node_id: NODE_ARPEGGIATOR,
                        port_id: ARPEGGIATOR_PORT_TICK,
                    },
                    destination: EventEndpoint {
                        node_id: NODE_ARPEGGIATOR,
                        port_id: ARPEGGIATOR_PORT_TICK_INPUT,
                    },
                    event_mask: EventRouteMask::TICK,
                    priority: 0,
                    enabled: true,
                },
                EventRoute {
                    source: EventEndpoint {
                        node_id: NODE_ARPEGGIATOR,
                        port_id: ARPEGGIATOR_PORT_NOTES,
                    },
                    destination: event_endpoint(NODE_VOICE),
                    event_mask: EventRouteMask::NOTE,
                    priority: 0,
                    enabled: true,
                },
            ],
            audio_execution_order: vec![NODE_VOICE, NODE_OUTPUT],
        }
    }

    fn note_on(source_node: u32, note: u8, velocity: f32, at_sample: u64) -> ScheduledEngineEvent {
        ScheduledEngineEvent::NoteOn {
            target_node: source_node,
            note,
            velocity,
            at_sample,
        }
    }

    fn note_off(source_node: u32, note: u8, at_sample: u64) -> ScheduledEngineEvent {
        ScheduledEngineEvent::NoteOff {
            target_node: source_node,
            note,
            at_sample,
        }
    }

    fn install_recording_node(prepared: &mut PreparedExecutionPlan, node_index: usize) {
        prepared.nodes[node_index] = RuntimeNode::Recording(RecordingNode::default());
    }

    fn recorded_events(
        prepared: &PreparedExecutionPlan,
        node_index: usize,
    ) -> &[ScheduledEngineEvent] {
        match &prepared.nodes[node_index] {
            RuntimeNode::Recording(node) => &node.events,
            _ => panic!("expected recording node"),
        }
    }

    #[test]
    fn prepared_event_graph_sorts_fanout_by_priority_then_destination() {
        let mut plan = plan_with_forwardable_event_nodes();

        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_OSCILLATOR),
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 20,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_OSCILLATOR),
                destination: event_endpoint(NODE_GAIN),
                event_mask: EventRouteMask::NOTE,
                priority: 10,
                enabled: true,
            },
        ];

        let prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert_eq!(prepared.event_route_count(), 2);
        assert_eq!(
            prepared.event_route_range_for_source(NODE_OSCILLATOR),
            Some((0, 2))
        );
        assert_eq!(prepared.event_route_destination_at(0), Some(1));
        assert_eq!(prepared.event_route_destination_at(1), Some(2));
    }

    #[test]
    fn endpoint_routes_preserve_port_zero_compatibility() {
        let plan = transposed_monophonic_voice_plan(12, 2);
        let prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert_eq!(
            prepared.event_route_range_for_source_endpoint(NODE_EVENT_INPUT, DEFAULT_EVENT_PORT),
            Some((0, 1))
        );
        assert_eq!(
            prepared.event_route_destination_port_at(0),
            Some(DEFAULT_EVENT_PORT)
        );
    }

    #[test]
    fn routes_from_one_output_port_to_one_input_port() {
        let mut plan = splitter_to_recording_plan();

        plan.event_routes.retain(|route| {
            route.source.node_id != NODE_EVENT_SPLITTER
                || route.source.port_id == EventSplitterNode::OUTPUT_A
        });

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        install_recording_node(&mut prepared, 2);
        install_recording_node(&mut prepared, 3);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 7)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 60,
                velocity: 0.75,
                at_sample: 7,
            }]
        );
        assert!(recorded_events(&prepared, 3).is_empty());
    }

    #[test]
    fn fanout_from_one_output_port_is_deterministic() {
        let mut plan = splitter_to_recording_plan();

        plan.event_routes = vec![
            plan.event_routes[0],
            EventRoute {
                source: EventEndpoint {
                    node_id: NODE_EVENT_SPLITTER,
                    port_id: EventSplitterNode::OUTPUT_A,
                },
                destination: event_endpoint(NODE_INSTRUMENT),
                event_mask: EventRouteMask::NOTE,
                priority: 20,
                enabled: true,
            },
            EventRoute {
                source: EventEndpoint {
                    node_id: NODE_EVENT_SPLITTER,
                    port_id: EventSplitterNode::OUTPUT_A,
                },
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 10,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        install_recording_node(&mut prepared, 2);
        install_recording_node(&mut prepared, 3);

        assert_eq!(
            prepared.event_route_range_for_source_endpoint(
                NODE_EVENT_SPLITTER,
                EventSplitterNode::OUTPUT_A
            ),
            Some((1, 2))
        );
        assert_eq!(prepared.event_route_destination_at(1), Some(2));
        assert_eq!(prepared.event_route_destination_at(2), Some(3));

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 61, 0.5, 8)));
        assert_eq!(recorded_events(&prepared, 2).len(), 1);
        assert_eq!(recorded_events(&prepared, 3).len(), 1);
    }

    #[test]
    fn two_output_ports_route_independently() {
        let plan = splitter_to_recording_plan();
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);
        install_recording_node(&mut prepared, 3);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 62, 0.25, 9)));
        assert_eq!(recorded_events(&prepared, 2).len(), 1);
        assert_eq!(recorded_events(&prepared, 3).len(), 1);
        assert_eq!(
            prepared.event_route_range_for_source_endpoint(
                NODE_EVENT_SPLITTER,
                EventSplitterNode::OUTPUT_A
            ),
            Some((1, 1))
        );
        assert_eq!(
            prepared.event_route_range_for_source_endpoint(
                NODE_EVENT_SPLITTER,
                EventSplitterNode::OUTPUT_B
            ),
            Some((2, 1))
        );
    }

    #[test]
    fn unknown_event_source_port_rejects_during_compilation() {
        let mut plan = splitter_to_recording_plan();

        plan.event_routes[1].source.port_id = 99;

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::UnknownEventSourcePort)
        ));
    }

    #[test]
    fn unknown_event_destination_port_rejects_during_compilation() {
        let mut plan = splitter_to_recording_plan();

        plan.event_routes[1].destination.port_id = 99;

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::UnknownEventDestinationPort)
        ));
    }

    #[test]
    fn event_delay_requests_future_note_on_from_delayed_output() {
        let plan = event_delay_to_recording_plan(8);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 16)));

        let request = prepared.take_future_event_request().unwrap();

        assert_eq!(
            request.source,
            EventEndpoint {
                node_id: NODE_EVENT_DELAY,
                port_id: EVENT_DELAY_PORT_DELAYED,
            }
        );
        assert_eq!(request.at_sample, 24);
        assert_eq!(
            request.owner,
            FutureEventOwner::revision_bound(1, 1, NODE_EVENT_DELAY)
        );
        assert_eq!(
            request.event,
            ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 60,
                velocity: 0.75,
                at_sample: 24,
            }
        );
        assert!(prepared.take_future_event_request().is_none());
        assert_eq!(
            prepared.event_graph_diagnostics().future_events_requested,
            1
        );
    }

    #[test]
    fn event_delay_requests_future_note_off_with_same_delay() {
        let plan = event_delay_to_recording_plan(12);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 64, 20)));

        let request = prepared.take_future_event_request().unwrap();

        assert_eq!(request.at_sample, 32);
        assert_eq!(
            request.owner,
            FutureEventOwner::revision_bound(1, 1, NODE_EVENT_DELAY)
        );
        assert_eq!(
            request.event,
            ScheduledEngineEvent::NoteOff {
                target_node: NODE_EVENT_INPUT,
                note: 64,
                at_sample: 32,
            }
        );
    }

    #[test]
    fn event_delay_rejects_zero_delay_during_preparation() {
        let plan = event_delay_to_recording_plan(0);

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::InvalidEventDelay)
        ));
    }

    #[test]
    fn future_event_queue_capacity_rejects_deterministically() {
        let mut plan = event_delay_to_recording_plan(1);

        plan.event_routes = (0..=MAX_FUTURE_EVENTS_PER_DISPATCH)
            .map(|index| EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_EVENT_DELAY),
                event_mask: EventRouteMask::NOTE,
                priority: index as u16,
                enabled: true,
            })
            .collect();

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));

        let mut request_count = 0;

        while prepared.take_future_event_request().is_some() {
            request_count += 1;
        }

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(request_count, MAX_FUTURE_EVENTS_PER_DISPATCH);
        assert_eq!(
            diagnostics.future_events_requested,
            MAX_FUTURE_EVENTS_PER_DISPATCH as u64
        );
        assert_eq!(diagnostics.future_events_dropped_capacity, 1);
    }

    #[test]
    fn arpeggiator_schedules_first_tick_from_held_note() {
        let plan = arpeggiator_to_recording_plan(8.0 / 24_000.0, 3.0 / 8.0, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 4)));
        assert!(recorded_events(&prepared, 2).is_empty());

        let request = prepared.take_future_event_request().unwrap();

        assert_eq!(
            request.source,
            EventEndpoint {
                node_id: NODE_ARPEGGIATOR,
                port_id: ARPEGGIATOR_PORT_TICK,
            }
        );
        assert_eq!(request.at_sample, 12);
        assert_eq!(
            request.owner,
            FutureEventOwner::generation_bound(1, 1, NODE_ARPEGGIATOR, 1)
        );
        assert_eq!(
            request.event,
            ScheduledEngineEvent::ArpeggiatorTick {
                target_node: NODE_ARPEGGIATOR,
                generation: 1,
                at_sample: 12,
            }
        );
    }

    #[test]
    fn arpeggiator_tick_emits_note_and_schedules_gate_and_next_tick() {
        let plan = arpeggiator_to_recording_plan(8.0 / 24_000.0, 3.0 / 8.0, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 0)));
        let tick = prepared.take_future_event_request().unwrap();

        assert!(prepared.dispatch_event_from(tick.source, tick.event));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_ARPEGGIATOR,
                note: 60,
                velocity: 0.75,
                at_sample: 8,
            }]
        );

        let note_off = prepared.take_future_event_request().unwrap();
        let next_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(
            note_off.source,
            EventEndpoint {
                node_id: NODE_ARPEGGIATOR,
                port_id: ARPEGGIATOR_PORT_NOTES,
            }
        );
        assert_eq!(note_off.at_sample, 11);
        assert_eq!(
            note_off.owner,
            FutureEventOwner::completion_required(1, 1, NODE_ARPEGGIATOR)
        );
        assert_eq!(
            note_off.event,
            ScheduledEngineEvent::NoteOff {
                target_node: NODE_ARPEGGIATOR,
                note: 60,
                at_sample: 11,
            }
        );
        assert_eq!(next_tick.at_sample, 16);
        assert_eq!(
            next_tick.owner,
            FutureEventOwner::generation_bound(1, 1, NODE_ARPEGGIATOR, 1)
        );
    }

    #[test]
    fn arpeggiator_uses_beat_timing_at_fixed_tempo() {
        let tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 120.0,
            sample_rate: 48_000.0,
        };
        let plan = arpeggiator_to_recording_plan(0.5, 0.5, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            tempo
        ));

        let tick = prepared.take_future_event_request().unwrap();

        assert_eq!(tick.at_sample, 12_000);
        assert!(prepared.dispatch_event_from_with_tempo(tick.source, tick.event, tempo));

        let note_off = prepared.take_future_event_request().unwrap();
        let next_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(note_off.at_sample, 18_000);
        assert_eq!(next_tick.at_sample, 24_000);
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_ARPEGGIATOR,
                note: 60,
                velocity: 0.75,
                at_sample: 12_000,
            }]
        );
    }

    #[test]
    fn arpeggiator_tick_timing_does_not_accumulate_rounding_drift() {
        let tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 123.0,
            sample_rate: 48_000.0,
        };
        let step_beats = 1.0 / 7.0;
        let plan = arpeggiator_to_recording_plan(step_beats, 0.5, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            tempo
        ));

        let mut tick = prepared.take_future_event_request().unwrap();

        for tick_index in 1..=512 {
            let expected_sample = tempo.beat_to_sample(tick_index as f64 * step_beats);

            assert_eq!(tick.at_sample, expected_sample);
            assert!(prepared.dispatch_event_from_with_tempo(tick.source, tick.event, tempo));

            let _note_off = prepared.take_future_event_request().unwrap();
            tick = prepared.take_future_event_request().unwrap();
        }
    }

    #[test]
    fn arpeggiator_free_running_phase_continues_across_loop_boundary() {
        let tempo = TempoMapSnapshot::default();
        let transport_loop = TransportLoop {
            enabled: true,
            start_sample: 0,
            end_sample: 36_000,
        };
        let plan = arpeggiator_to_recording_plan(1.0, 0.5, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            tempo,
            transport_loop
        ));

        let first_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(first_tick.at_sample, 24_000);
        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            first_tick.source,
            first_tick.event,
            tempo,
            transport_loop
        ));

        let _note_off = prepared.take_future_event_request().unwrap();
        let second_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(second_tick.at_sample, 48_000);
    }

    #[test]
    fn arpeggiator_loop_locked_phase_resets_to_loop_boundary() {
        let tempo = TempoMapSnapshot::default();
        let transport_loop = TransportLoop {
            enabled: true,
            start_sample: 0,
            end_sample: 36_000,
        };
        let mut plan = arpeggiator_to_recording_plan(1.0, 0.5, 4);

        if let PlanNodeKind::Arpeggiator(node) = &mut plan.nodes[1].kind {
            node.phase_mode = ArpeggiatorPhaseMode::LoopLocked;
        }

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            tempo,
            transport_loop
        ));

        let first_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(first_tick.at_sample, 24_000);
        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            first_tick.source,
            first_tick.event,
            tempo,
            transport_loop
        ));

        let _note_off = prepared.take_future_event_request().unwrap();
        let boundary_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(boundary_tick.at_sample, 36_000);
        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            boundary_tick.source,
            boundary_tick.event,
            tempo,
            transport_loop
        ));

        let _boundary_note_off = prepared.take_future_event_request().unwrap();
        let next_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(next_tick.at_sample, 60_000);
    }

    #[test]
    fn arpeggiator_loop_locked_phase_does_not_drift_over_many_loops() {
        let tempo = TempoMapSnapshot::default();
        let transport_loop = TransportLoop {
            enabled: true,
            start_sample: 0,
            end_sample: 36_000,
        };
        let mut plan = arpeggiator_to_recording_plan(1.0, 0.5, 4);

        if let PlanNodeKind::Arpeggiator(node) = &mut plan.nodes[1].kind {
            node.phase_mode = ArpeggiatorPhaseMode::LoopLocked;
        }

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            tempo,
            transport_loop
        ));

        let mut tick = prepared.take_future_event_request().unwrap();

        for step in 0..128 {
            let loop_index = step / 2;
            let expected_sample = if step % 2 == 0 {
                loop_index * 36_000 + 24_000
            } else {
                (loop_index + 1) * 36_000
            };

            assert_eq!(tick.at_sample, expected_sample);
            assert!(prepared.dispatch_event_from_with_tempo_and_loop(
                tick.source,
                tick.event,
                tempo,
                transport_loop
            ));

            let _note_off = prepared.take_future_event_request().unwrap();
            tick = prepared.take_future_event_request().unwrap();
        }
    }

    #[test]
    fn arpeggiator_loop_locked_pattern_phase_resets_after_wrap() {
        let tempo = TempoMapSnapshot::default();
        let transport_loop = TransportLoop {
            enabled: true,
            start_sample: 0,
            end_sample: 36_000,
        };

        for (pattern, expected_notes) in [
            (ArpeggiatorPattern::Ascending, vec![60, 64, 60]),
            (ArpeggiatorPattern::Descending, vec![67, 64, 67]),
            (ArpeggiatorPattern::UpDown, vec![60, 64, 60]),
            (ArpeggiatorPattern::PlayedOrder, vec![64, 60, 64]),
        ] {
            let mut plan = arpeggiator_to_recording_plan_with_pattern(1.0, 0.5, 4, pattern);

            if let PlanNodeKind::Arpeggiator(node) = &mut plan.nodes[1].kind {
                node.phase_mode = ArpeggiatorPhaseMode::LoopLocked;
            }

            let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

            install_recording_node(&mut prepared, 2);

            for (index, note) in [64, 60, 67].into_iter().enumerate() {
                assert!(prepared.dispatch_event_from_with_tempo_and_loop(
                    event_endpoint(NODE_EVENT_INPUT),
                    note_on(NODE_EVENT_INPUT, note, 0.75, index as u64),
                    tempo,
                    transport_loop
                ));
            }

            for index in 0..expected_notes.len() {
                dispatch_next_valid_arpeggiator_tick_with_loop(
                    &mut prepared,
                    tempo,
                    transport_loop,
                );

                if index + 1 < expected_notes.len() {
                    discard_generated_note_off(&mut prepared);
                }
            }

            let actual_notes: Vec<_> = recorded_events(&prepared, 2)
                .iter()
                .filter_map(|event| match event {
                    ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                    _ => None,
                })
                .collect();

            assert_eq!(actual_notes, expected_notes);
        }
    }

    #[test]
    fn arpeggiator_loop_locked_gate_note_off_can_cross_loop_boundary() {
        let tempo = TempoMapSnapshot::default();
        let transport_loop = TransportLoop {
            enabled: true,
            start_sample: 0,
            end_sample: 36_000,
        };
        let mut plan = arpeggiator_to_recording_plan(1.0, 0.75, 4);

        if let PlanNodeKind::Arpeggiator(node) = &mut plan.nodes[1].kind {
            node.phase_mode = ArpeggiatorPhaseMode::LoopLocked;
        }

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            tempo,
            transport_loop
        ));

        let first_tick = prepared.take_future_event_request().unwrap();

        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            first_tick.source,
            first_tick.event,
            tempo,
            transport_loop
        ));

        let note_off = prepared.take_future_event_request().unwrap();
        let boundary_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(note_off.at_sample, 42_000);
        assert_eq!(boundary_tick.at_sample, 36_000);
        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            boundary_tick.source,
            boundary_tick.event,
            tempo,
            transport_loop
        ));
        assert!(prepared.dispatch_event_from_with_tempo_and_loop(
            note_off.source,
            note_off.event,
            tempo,
            transport_loop
        ));
        assert!(
            recorded_events(&prepared, 2).contains(&ScheduledEngineEvent::NoteOff {
                target_node: NODE_ARPEGGIATOR,
                note: 60,
                at_sample: 42_000,
            })
        );
    }

    #[test]
    fn arpeggiator_tempo_change_regenerates_uncommitted_tick() {
        let initial_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 120.0,
            sample_rate: 48_000.0,
        };
        let slower_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 60.0,
            sample_rate: 48_000.0,
        };
        let plan = arpeggiator_to_recording_plan(1.0, 0.5, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            initial_tempo
        ));

        let stale_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(stale_tick.at_sample, 24_000);

        prepared.regenerate_future_events_for_tempo_change(
            0,
            1,
            initial_tempo,
            slower_tempo,
            TransportLoop::default(),
        );

        let retimed_tick = prepared.take_future_event_request().unwrap();

        assert_eq!(retimed_tick.at_sample, 48_000);
        assert_eq!(
            retimed_tick.owner,
            FutureEventOwner::generation_bound(1, 1, NODE_ARPEGGIATOR, 2)
        );
        assert!(!prepared.dispatch_event_from_with_tempo(
            stale_tick.source,
            stale_tick.event,
            slower_tempo
        ));
        assert!(prepared.dispatch_event_from_with_tempo(
            retimed_tick.source,
            retimed_tick.event,
            slower_tempo
        ));
    }

    #[test]
    fn arpeggiator_tempo_change_keeps_committed_tick_sample() {
        let initial_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 120.0,
            sample_rate: 48_000.0,
        };
        let slower_tempo = TempoMapSnapshot {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 60.0,
            sample_rate: 48_000.0,
        };
        let plan = arpeggiator_to_recording_plan(1.0, 0.5, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event_from_with_tempo(
            event_endpoint(NODE_EVENT_INPUT),
            note_on(NODE_EVENT_INPUT, 60, 0.75, 0),
            initial_tempo
        ));

        let committed_tick = prepared.take_future_event_request().unwrap();

        prepared.regenerate_future_events_for_tempo_change(
            0,
            24_001,
            initial_tempo,
            slower_tempo,
            TransportLoop::default(),
        );

        assert!(prepared.take_future_event_request().is_none());
        assert!(prepared.dispatch_event_from_with_tempo(
            committed_tick.source,
            committed_tick.event,
            slower_tempo
        ));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_ARPEGGIATOR,
                note: 60,
                velocity: 0.75,
                at_sample: 24_000,
            }]
        );
    }

    #[test]
    fn arpeggiator_orders_held_notes_ascending() {
        let plan = arpeggiator_to_recording_plan(8.0 / 24_000.0, 2.0 / 8.0, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 0)));
        let stale_tick = prepared.take_future_event_request().unwrap();
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 1)));
        let tick = prepared.take_future_event_request().unwrap();

        assert!(!prepared.dispatch_event_from(stale_tick.source, stale_tick.event));
        assert!(prepared.dispatch_event_from(tick.source, tick.event));
        let _note_off = prepared.take_future_event_request().unwrap();
        let next_tick = prepared.take_future_event_request().unwrap();
        assert!(prepared.dispatch_event_from(next_tick.source, next_tick.event));

        assert_eq!(
            recorded_events(&prepared, 2),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_ARPEGGIATOR,
                    note: 60,
                    velocity: 0.75,
                    at_sample: 8,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_ARPEGGIATOR,
                    note: 64,
                    velocity: 0.5,
                    at_sample: 16,
                },
            ]
        );
    }

    fn dispatch_next_valid_arpeggiator_tick(prepared: &mut PreparedExecutionPlan) {
        loop {
            let request = prepared
                .take_future_event_request()
                .expect("scheduled arpeggiator tick should exist");

            if prepared.dispatch_event_from(request.source, request.event) {
                break;
            }
        }
    }

    fn dispatch_next_valid_arpeggiator_tick_with_loop(
        prepared: &mut PreparedExecutionPlan,
        tempo: TempoMapSnapshot,
        transport_loop: TransportLoop,
    ) {
        loop {
            let request = prepared
                .take_future_event_request()
                .expect("scheduled arpeggiator tick should exist");

            if prepared.dispatch_event_from_with_tempo_and_loop(
                request.source,
                request.event,
                tempo,
                transport_loop,
            ) {
                break;
            }
        }
    }

    fn discard_generated_note_off(prepared: &mut PreparedExecutionPlan) {
        let _note_off = prepared
            .take_future_event_request()
            .expect("generated note-off should exist");
    }

    fn arpeggiator_recorded_note_ons(
        pattern: ArpeggiatorPattern,
        input_notes: &[u8],
        tick_count: usize,
    ) -> Vec<u8> {
        let plan =
            arpeggiator_to_recording_plan_with_pattern(8.0 / 24_000.0, 2.0 / 8.0, 8, pattern);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        for (index, note) in input_notes.iter().copied().enumerate() {
            assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, note, 0.5, index as u64)));
        }

        for index in 0..tick_count {
            dispatch_next_valid_arpeggiator_tick(&mut prepared);

            if index + 1 < tick_count {
                discard_generated_note_off(&mut prepared);
            }
        }

        recorded_events(&prepared, 2)
            .iter()
            .filter_map(|event| match event {
                ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                _ => None,
            })
            .collect()
    }

    fn arpeggiator_recorded_note_ons_with_octaves(
        pattern: ArpeggiatorPattern,
        input_notes: &[u8],
        tick_count: usize,
        octave_count: u8,
        octave_direction: ArpeggiatorOctaveDirection,
    ) -> Vec<u8> {
        let plan = arpeggiator_to_recording_plan_with_pattern_and_octaves(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            pattern,
            octave_count,
            octave_direction,
        );
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        for (index, note) in input_notes.iter().copied().enumerate() {
            assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, note, 0.5, index as u64)));
        }

        for index in 0..tick_count {
            dispatch_next_valid_arpeggiator_tick(&mut prepared);

            if index + 1 < tick_count {
                discard_generated_note_off(&mut prepared);
            }
        }

        recorded_events(&prepared, 2)
            .iter()
            .filter_map(|event| match event {
                ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                _ => None,
            })
            .collect()
    }

    fn arpeggiator_recorded_note_ons_with_seed(
        input_notes: &[u8],
        tick_count: usize,
        random_seed: u64,
    ) -> Vec<u8> {
        let plan = arpeggiator_to_recording_plan_with_pattern_octaves_and_seed(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Random,
            1,
            ArpeggiatorOctaveDirection::Up,
            random_seed,
        );
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        for (index, note) in input_notes.iter().copied().enumerate() {
            assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, note, 0.5, index as u64)));
        }

        for index in 0..tick_count {
            dispatch_next_valid_arpeggiator_tick(&mut prepared);

            if index + 1 < tick_count {
                discard_generated_note_off(&mut prepared);
            }
        }

        recorded_events(&prepared, 2)
            .iter()
            .filter_map(|event| match event {
                ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn arpeggiator_descending_pattern_orders_notes_high_to_low() {
        assert_eq!(
            arpeggiator_recorded_note_ons(ArpeggiatorPattern::Descending, &[64, 60, 67], 5),
            vec![67, 64, 60, 67, 64]
        );
    }

    #[test]
    fn arpeggiator_up_down_pattern_does_not_repeat_endpoints() {
        assert_eq!(
            arpeggiator_recorded_note_ons(ArpeggiatorPattern::UpDown, &[64, 60, 67], 7),
            vec![60, 64, 67, 64, 60, 64, 67]
        );
    }

    #[test]
    fn arpeggiator_played_order_pattern_uses_note_on_order() {
        assert_eq!(
            arpeggiator_recorded_note_ons(ArpeggiatorPattern::PlayedOrder, &[64, 60, 67], 5),
            vec![64, 60, 67, 64, 60]
        );
    }

    #[test]
    fn arpeggiator_random_pattern_is_deterministic_for_same_seed() {
        let first = arpeggiator_recorded_note_ons_with_seed(&[60, 64, 67, 71], 12, 1234);
        let second = arpeggiator_recorded_note_ons_with_seed(&[60, 64, 67, 71], 12, 1234);

        assert_eq!(first, second);
    }

    #[test]
    fn arpeggiator_random_pattern_differs_for_different_seeds() {
        let first = arpeggiator_recorded_note_ons_with_seed(&[60, 64, 67, 71], 12, 1234);
        let second = arpeggiator_recorded_note_ons_with_seed(&[60, 64, 67, 71], 12, 5678);

        assert_ne!(first, second);
    }

    #[test]
    fn arpeggiator_duplicate_note_on_updates_velocity_without_reordering() {
        let plan = arpeggiator_to_recording_plan_with_pattern(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::PlayedOrder,
        );
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.25, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 1)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.9, 2)));

        dispatch_next_valid_arpeggiator_tick(&mut prepared);
        discard_generated_note_off(&mut prepared);
        dispatch_next_valid_arpeggiator_tick(&mut prepared);

        assert_eq!(
            recorded_events(&prepared, 2),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_ARPEGGIATOR,
                    note: 64,
                    velocity: 0.9,
                    at_sample: 8,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_ARPEGGIATOR,
                    note: 60,
                    velocity: 0.5,
                    at_sample: 16,
                },
            ]
        );
    }

    #[test]
    fn arpeggiator_note_removal_preserves_pattern_position() {
        let plan = arpeggiator_to_recording_plan_with_pattern(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Ascending,
        );
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 1)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 67, 0.5, 2)));

        dispatch_next_valid_arpeggiator_tick(&mut prepared);
        discard_generated_note_off(&mut prepared);

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 64, 9)));

        dispatch_next_valid_arpeggiator_tick(&mut prepared);

        assert_eq!(
            recorded_events(&prepared, 2)
                .iter()
                .filter_map(|event| match event {
                    ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec![60, 67]
        );
    }

    #[test]
    fn arpeggiator_one_note_behaves_consistently_in_all_patterns() {
        for pattern in [
            ArpeggiatorPattern::Ascending,
            ArpeggiatorPattern::Descending,
            ArpeggiatorPattern::UpDown,
            ArpeggiatorPattern::PlayedOrder,
            ArpeggiatorPattern::Random,
        ] {
            assert_eq!(
                arpeggiator_recorded_note_ons(pattern, &[65], 4),
                vec![65, 65, 65, 65]
            );
        }
    }

    #[test]
    fn arpeggiator_one_octave_matches_existing_pattern_behaviour() {
        assert_eq!(
            arpeggiator_recorded_note_ons_with_octaves(
                ArpeggiatorPattern::Ascending,
                &[64, 60, 67],
                5,
                1,
                ArpeggiatorOctaveDirection::Up,
            ),
            vec![60, 64, 67, 60, 64]
        );
    }

    #[test]
    fn arpeggiator_two_octave_ascending_sequence_layers_octaves_up() {
        assert_eq!(
            arpeggiator_recorded_note_ons_with_octaves(
                ArpeggiatorPattern::Ascending,
                &[64, 60, 67],
                7,
                2,
                ArpeggiatorOctaveDirection::Up,
            ),
            vec![60, 64, 67, 72, 76, 79, 60]
        );
    }

    #[test]
    fn arpeggiator_two_octave_down_sequence_layers_octaves_down() {
        assert_eq!(
            arpeggiator_recorded_note_ons_with_octaves(
                ArpeggiatorPattern::Ascending,
                &[64, 60, 67],
                7,
                2,
                ArpeggiatorOctaveDirection::Down,
            ),
            vec![60, 64, 67, 48, 52, 55, 60]
        );
    }

    #[test]
    fn arpeggiator_octave_up_down_does_not_repeat_octave_endpoints() {
        assert_eq!(
            arpeggiator_recorded_note_ons_with_octaves(
                ArpeggiatorPattern::Ascending,
                &[60, 64],
                9,
                3,
                ArpeggiatorOctaveDirection::UpDown,
            ),
            vec![60, 64, 72, 76, 84, 88, 72, 76, 60]
        );
    }

    #[test]
    fn arpeggiator_octave_out_of_range_notes_are_suppressed_without_shortening_phrase() {
        let plan = arpeggiator_to_recording_plan_with_pattern_and_octaves(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Ascending,
            2,
            ArpeggiatorOctaveDirection::Up,
        );
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 120, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 123, 0.5, 1)));

        dispatch_next_valid_arpeggiator_tick(&mut prepared);
        discard_generated_note_off(&mut prepared);
        dispatch_next_valid_arpeggiator_tick(&mut prepared);
        discard_generated_note_off(&mut prepared);
        dispatch_next_valid_arpeggiator_tick(&mut prepared);
        dispatch_next_valid_arpeggiator_tick(&mut prepared);
        dispatch_next_valid_arpeggiator_tick(&mut prepared);

        assert_eq!(
            recorded_events(&prepared, 2)
                .iter()
                .filter_map(|event| match event {
                    ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec![120, 123, 120]
        );
    }

    #[test]
    fn arpeggiator_loop_locked_octave_phase_resets_after_wrap() {
        let tempo = TempoMapSnapshot::default();
        let transport_loop = TransportLoop {
            enabled: true,
            start_sample: 0,
            end_sample: 36_000,
        };
        let mut plan = arpeggiator_to_recording_plan_with_pattern_and_octaves(
            1.0,
            0.5,
            4,
            ArpeggiatorPattern::Ascending,
            2,
            ArpeggiatorOctaveDirection::Up,
        );

        if let PlanNodeKind::Arpeggiator(node) = &mut plan.nodes[1].kind {
            node.phase_mode = ArpeggiatorPhaseMode::LoopLocked;
        }

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        for (index, note) in [60, 64].into_iter().enumerate() {
            assert!(prepared.dispatch_event_from_with_tempo_and_loop(
                event_endpoint(NODE_EVENT_INPUT),
                note_on(NODE_EVENT_INPUT, note, 0.75, index as u64),
                tempo,
                transport_loop
            ));
        }

        for index in 0..3 {
            dispatch_next_valid_arpeggiator_tick_with_loop(&mut prepared, tempo, transport_loop);

            if index < 2 {
                discard_generated_note_off(&mut prepared);
            }
        }

        let actual_notes: Vec<_> = recorded_events(&prepared, 2)
            .iter()
            .filter_map(|event| match event {
                ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                _ => None,
            })
            .collect();

        assert_eq!(actual_notes, vec![60, 64, 60]);
    }

    #[test]
    fn arpeggiator_random_octave_expansion_uses_expanded_candidate_set() {
        let notes = arpeggiator_recorded_note_ons_with_octaves(
            ArpeggiatorPattern::Random,
            &[60, 64],
            16,
            2,
            ArpeggiatorOctaveDirection::Up,
        );

        assert!(notes.iter().all(|note| [60, 64, 72, 76].contains(note)));
        assert!(notes.iter().any(|note| *note >= 72));
    }

    #[test]
    fn loop_locked_random_arpeggiator_repeats_seeded_phrase_each_loop() {
        let tempo = TempoMapSnapshot::default();
        let transport_loop = TransportLoop {
            enabled: true,
            start_sample: 0,
            end_sample: 72_000,
        };
        let mut plan = arpeggiator_to_recording_plan_with_pattern_octaves_and_seed(
            1.0,
            0.5,
            4,
            ArpeggiatorPattern::Random,
            1,
            ArpeggiatorOctaveDirection::Up,
            99,
        );

        if let PlanNodeKind::Arpeggiator(node) = &mut plan.nodes[1].kind {
            node.phase_mode = ArpeggiatorPhaseMode::LoopLocked;
        }

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        for (index, note) in [60, 64, 67].into_iter().enumerate() {
            assert!(prepared.dispatch_event_from_with_tempo_and_loop(
                event_endpoint(NODE_EVENT_INPUT),
                note_on(NODE_EVENT_INPUT, note, 0.75, index as u64),
                tempo,
                transport_loop
            ));
        }

        for index in 0..6 {
            dispatch_next_valid_arpeggiator_tick_with_loop(&mut prepared, tempo, transport_loop);

            if index < 5 {
                discard_generated_note_off(&mut prepared);
            }
        }

        let actual_notes: Vec<_> = recorded_events(&prepared, 2)
            .iter()
            .filter_map(|event| match event {
                ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                _ => None,
            })
            .collect();

        assert_eq!(&actual_notes[0..3], &actual_notes[3..6]);
    }

    #[test]
    fn state_transfer_preserves_arpeggiator_played_order_position() {
        let old_plan = arpeggiator_to_recording_plan_with_pattern(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::PlayedOrder,
        );
        let mut new_plan = old_plan.clone();

        new_plan.plan_revision = 2;

        let mut old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();

        install_recording_node(&mut old_prepared, 2);
        install_recording_node(&mut new_prepared, 2);

        for (index, note) in [64, 60, 67].into_iter().enumerate() {
            assert!(old_prepared.dispatch_event(note_on(
                NODE_EVENT_INPUT,
                note,
                0.5,
                index as u64
            )));
        }

        dispatch_next_valid_arpeggiator_tick(&mut old_prepared);

        let first_note_off = old_prepared.take_future_event_request().unwrap();
        let stale_next_tick = old_prepared.take_future_event_request().unwrap();
        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert_eq!(
            transfer.entries.as_ref(),
            &[StateTransferEntry {
                old_node_index: 1,
                new_node_index: 1,
                kind: StateTransferKind::Arpeggiator,
            }]
        );

        new_prepared
            .apply_state_transfer_from(&old_prepared, &transfer)
            .unwrap();

        assert!(!new_prepared.dispatch_event_from(stale_next_tick.source, stale_next_tick.event));
        assert!(new_prepared.dispatch_event_from(first_note_off.source, first_note_off.event));

        new_prepared.regenerate_future_events_after_state_transfer(
            8,
            TempoMapSnapshot::default(),
            TransportLoop::default(),
        );

        let regenerated_tick = new_prepared.take_future_event_request().unwrap();

        assert_eq!(regenerated_tick.at_sample, 16);
        assert_eq!(
            regenerated_tick.owner,
            FutureEventOwner::generation_bound(1, 2, NODE_ARPEGGIATOR, 4)
        );
        assert!(new_prepared.dispatch_event_from(regenerated_tick.source, regenerated_tick.event));

        assert_eq!(
            recorded_events(&new_prepared, 2),
            &[
                ScheduledEngineEvent::NoteOff {
                    target_node: NODE_ARPEGGIATOR,
                    note: 64,
                    at_sample: 10,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_ARPEGGIATOR,
                    note: 60,
                    velocity: 0.5,
                    at_sample: 16,
                },
            ]
        );
    }

    #[test]
    fn state_transfer_preserves_arpeggiator_random_stream_position() {
        let plan = arpeggiator_to_recording_plan_with_pattern_octaves_and_seed(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Random,
            1,
            ArpeggiatorOctaveDirection::Up,
            1234,
        );
        let mut new_plan = plan.clone();

        new_plan.plan_revision = 2;

        let mut continuous = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        let mut old_prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();

        install_recording_node(&mut continuous, 2);
        install_recording_node(&mut old_prepared, 2);
        install_recording_node(&mut new_prepared, 2);

        for (index, note) in [60, 64, 67, 71].into_iter().enumerate() {
            let event = note_on(NODE_EVENT_INPUT, note, 0.5, index as u64);

            assert!(continuous.dispatch_event(event));
            assert!(old_prepared.dispatch_event(event));
        }

        dispatch_next_valid_arpeggiator_tick(&mut continuous);
        discard_generated_note_off(&mut continuous);
        dispatch_next_valid_arpeggiator_tick(&mut old_prepared);

        let first_note_off = old_prepared.take_future_event_request().unwrap();
        let stale_next_tick = old_prepared.take_future_event_request().unwrap();
        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        new_prepared
            .apply_state_transfer_from(&old_prepared, &transfer)
            .unwrap();

        assert!(!new_prepared.dispatch_event_from(stale_next_tick.source, stale_next_tick.event));
        assert!(new_prepared.dispatch_event_from(first_note_off.source, first_note_off.event));

        new_prepared.regenerate_future_events_after_state_transfer(
            8,
            TempoMapSnapshot::default(),
            TransportLoop::default(),
        );

        let regenerated_tick = new_prepared.take_future_event_request().unwrap();

        dispatch_next_valid_arpeggiator_tick(&mut continuous);
        assert!(new_prepared.dispatch_event_from(regenerated_tick.source, regenerated_tick.event));

        let continuous_notes: Vec<_> = recorded_events(&continuous, 2)
            .iter()
            .filter_map(|event| match event {
                ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                _ => None,
            })
            .collect();
        let transferred_notes: Vec<_> = recorded_events(&new_prepared, 2)
            .iter()
            .filter_map(|event| match event {
                ScheduledEngineEvent::NoteOn { note, .. } => Some(*note),
                _ => None,
            })
            .collect();

        assert_eq!(transferred_notes, vec![continuous_notes[1]]);
    }

    #[test]
    fn incompatible_arpeggiator_pattern_is_not_transferred() {
        let old_plan = arpeggiator_to_recording_plan_with_pattern(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Ascending,
        );
        let new_plan = arpeggiator_to_recording_plan_with_pattern(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Descending,
        );
        let old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert!(transfer.entries.is_empty());
    }

    #[test]
    fn incompatible_arpeggiator_random_seed_is_not_transferred() {
        let old_plan = arpeggiator_to_recording_plan_with_pattern_octaves_and_seed(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Random,
            1,
            ArpeggiatorOctaveDirection::Up,
            1234,
        );
        let new_plan = arpeggiator_to_recording_plan_with_pattern_octaves_and_seed(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Random,
            1,
            ArpeggiatorOctaveDirection::Up,
            5678,
        );
        let old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert!(transfer.entries.is_empty());
    }

    #[test]
    fn changed_arpeggiator_octave_configuration_is_not_transferred() {
        let old_plan = arpeggiator_to_recording_plan_with_pattern_and_octaves(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Ascending,
            2,
            ArpeggiatorOctaveDirection::Up,
        );
        let new_plan = arpeggiator_to_recording_plan_with_pattern_and_octaves(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Ascending,
            3,
            ArpeggiatorOctaveDirection::Up,
        );
        let old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert!(transfer.entries.is_empty());
    }

    #[test]
    fn explicit_incompatible_arpeggiator_transfer_rejects() {
        let old_plan = arpeggiator_to_recording_plan_with_pattern(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Ascending,
        );
        let new_plan = arpeggiator_to_recording_plan_with_pattern(
            8.0 / 24_000.0,
            2.0 / 8.0,
            8,
            ArpeggiatorPattern::Descending,
        );
        let old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let transfer = PlanStateTransfer {
            entries: vec![StateTransferEntry {
                old_node_index: 1,
                new_node_index: 1,
                kind: StateTransferKind::Arpeggiator,
            }]
            .into_boxed_slice(),
        };

        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &transfer),
            Err(StateTransferError::IncompatibleArpeggiator)
        );
    }

    #[test]
    fn arpeggiator_note_off_allows_generated_gate_note_off_to_complete() {
        let plan = arpeggiator_to_recording_plan(8.0 / 24_000.0, 3.0 / 8.0, 4);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 0)));
        let tick = prepared.take_future_event_request().unwrap();
        assert!(prepared.dispatch_event_from(tick.source, tick.event));
        let generated_note_off = prepared.take_future_event_request().unwrap();
        let next_tick = prepared.take_future_event_request().unwrap();

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 60, 9)));
        assert!(prepared.dispatch_event_from(generated_note_off.source, generated_note_off.event));
        assert!(!prepared.dispatch_event_from(next_tick.source, next_tick.event));

        assert_eq!(
            recorded_events(&prepared, 2),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_ARPEGGIATOR,
                    note: 60,
                    velocity: 0.75,
                    at_sample: 8,
                },
                ScheduledEngineEvent::NoteOff {
                    target_node: NODE_ARPEGGIATOR,
                    note: 60,
                    at_sample: 11,
                },
            ]
        );
    }

    #[test]
    fn arpeggiator_rejects_invalid_configuration() {
        for (step_beats, gate_ratio, maximum_held_notes) in [
            (0.0, 0.5, 4),
            (f64::NAN, 0.5, 4),
            (0.25, 0.0, 4),
            (0.25, 1.0, 4),
            (0.25, f32::NAN, 4),
            (0.25, 0.5, 0),
            (0.25, 0.5, MAX_ARPEGGIATOR_HELD_NOTES + 1),
        ] {
            let plan = arpeggiator_to_recording_plan(step_beats, gate_ratio, maximum_held_notes);

            assert!(matches!(
                PreparedExecutionPlan::prepare(&plan, 128),
                Err(PlanValidationError::InvalidArpeggiatorConfig)
            ));
        }

        let plan = arpeggiator_to_recording_plan_with_pattern_and_octaves(
            0.25,
            0.5,
            4,
            ArpeggiatorPattern::Ascending,
            0,
            ArpeggiatorOctaveDirection::Up,
        );

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::InvalidArpeggiatorConfig)
        ));
    }

    #[test]
    fn incompatible_event_port_direction_rejects_during_compilation() {
        let mut plan = splitter_to_recording_plan();

        plan.event_routes[1].source.port_id = DEFAULT_EVENT_PORT;

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::IncompatibleEventRoute)
        ));
    }

    #[test]
    fn event_masks_are_checked_against_port_capabilities() {
        let mut plan = splitter_to_recording_plan();

        plan.event_routes[1].source.port_id = EventSplitterNode::OUTPUT_EMPTY;

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::IncompatibleEventRoute)
        ));
    }

    #[test]
    fn disabled_event_routes_are_excluded_from_dispatch() {
        let mut plan = monophonic_voice_plan(2);

        plan.event_routes = vec![EventRoute {
            source: event_endpoint(NODE_VOICE),
            destination: event_endpoint(NODE_VOICE),
            event_mask: EventRouteMask::NOTE,
            priority: 0,
            enabled: false,
        }];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert_eq!(prepared.event_route_count(), 0);
        assert!(!prepared.dispatch_event(note_on_from(NODE_VOICE)));
        assert_eq!(
            prepared.event_graph_diagnostics(),
            EventGraphDiagnostics {
                events_received: 1,
                ..EventGraphDiagnostics::default()
            }
        );
    }

    #[test]
    fn event_emission_reenters_the_prepared_event_graph() {
        let mut plan = plan_with_forwardable_event_nodes();

        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_OSCILLATOR),
                destination: event_endpoint(NODE_GAIN),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_GAIN),
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        prepared.nodes[1] = RuntimeNode::Forwarding(ForwardingNode);

        assert!(prepared.dispatch_event(note_on_from(NODE_OSCILLATOR)));

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_received, 2);
        assert_eq!(diagnostics.route_dispatches, 2);
        assert_eq!(diagnostics.events_emitted, 1);
    }

    #[test]
    fn event_cycle_is_stopped_by_depth_limit() {
        let mut plan = plan_with_forwardable_event_nodes();

        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_OSCILLATOR),
                destination: event_endpoint(NODE_GAIN),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_GAIN),
                destination: event_endpoint(NODE_OSCILLATOR),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        prepared.nodes[0] = RuntimeNode::Forwarding(ForwardingNode);
        prepared.nodes[1] = RuntimeNode::Forwarding(ForwardingNode);

        assert!(prepared.dispatch_event(note_on_from(NODE_OSCILLATOR)));
        assert_eq!(prepared.event_graph_diagnostics().events_dropped_depth, 1);
    }

    #[test]
    fn fanout_budget_is_enforced_deterministically() {
        let mut plan = plan_with_forwardable_event_nodes();

        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_OSCILLATOR),
                destination: event_endpoint(NODE_GAIN),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_GAIN),
                destination: event_endpoint(NODE_GAIN),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        prepared.nodes[1] = RuntimeNode::Burst(BurstNode {
            events_per_input: 2,
        });

        assert!(prepared.dispatch_event(note_on_from(NODE_OSCILLATOR)));

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_received, MAX_EVENTS_PER_BLOCK as u64);
        assert_eq!(diagnostics.events_dropped_budget, 1);
    }

    #[test]
    fn transpose_node_transforms_note_on_and_preserves_timestamp_and_velocity() {
        let plan = transpose_to_recording_plan(12);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 123)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 72,
                velocity: 0.75,
                at_sample: 123,
            }]
        );

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_received, 2);
        assert_eq!(diagnostics.events_emitted, 1);
        assert_eq!(diagnostics.events_suppressed, 0);
    }

    #[test]
    fn transpose_node_transforms_matching_note_off() {
        let plan = transpose_to_recording_plan(-12);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 72, 456)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOff {
                target_node: NODE_EVENT_INPUT,
                note: 60,
                at_sample: 456,
            }]
        );
    }

    #[test]
    fn transpose_node_suppresses_out_of_range_notes() {
        let plan = transpose_to_recording_plan(12);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 120, 1.0, 0)));
        assert!(recorded_events(&prepared, 2).is_empty());

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_emitted, 0);
        assert_eq!(diagnostics.events_suppressed, 1);
    }

    #[test]
    fn transpose_nodes_compose_predictably() {
        let mut plan = transpose_to_recording_plan(7);
        let second_transpose_id = 7;

        plan.nodes.insert(
            2,
            PlanNode {
                id: second_transpose_id,
                kind: PlanNodeKind::Transpose(TransposeNodePlan { semitones: 5 }),
            },
        );
        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_TRANSPOSE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_TRANSPOSE),
                destination: event_endpoint(second_transpose_id),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(second_transpose_id),
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 3);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 99)));
        assert_eq!(
            recorded_events(&prepared, 3),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 72,
                velocity: 0.5,
                at_sample: 99,
            }]
        );
    }

    #[test]
    fn disabled_route_after_transpose_bypasses_propagation() {
        let mut plan = transpose_to_recording_plan(12);

        plan.event_routes[1].enabled = false;

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(recorded_events(&prepared, 2).is_empty());

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_emitted, 1);
        assert_eq!(diagnostics.route_dispatches, 1);
    }

    #[test]
    fn fanout_after_transpose_remains_deterministic() {
        let mut plan = transpose_to_recording_plan(12);

        plan.event_routes.push(EventRoute {
            source: event_endpoint(NODE_TRANSPOSE),
            destination: event_endpoint(NODE_OUTPUT),
            event_mask: EventRouteMask::NOTE,
            priority: 0,
            enabled: true,
        });
        plan.event_routes[1].priority = 20;

        let prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        let (start, len) = prepared
            .event_route_range_for_source(NODE_TRANSPOSE)
            .expect("transpose source should have prepared routes");

        assert_eq!(len, 2);
        assert_eq!(prepared.event_route_destination_at(start as usize), Some(3));
        assert_eq!(
            prepared.event_route_destination_at(start as usize + 1),
            Some(2)
        );
    }

    #[test]
    fn velocity_node_identity_preserves_note_on_fields() {
        let plan = velocity_to_recording_plan(VelocityNodePlan {
            multiplier: 1.0,
            offset: 0.0,
            minimum: 0.0,
            maximum: 1.0,
        });
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.42, 123)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 60,
                velocity: 0.42,
                at_sample: 123,
            }]
        );
    }

    #[test]
    fn velocity_node_applies_scaling_offset_and_clamps() {
        let plan = velocity_to_recording_plan(VelocityNodePlan {
            multiplier: 2.0,
            offset: 0.1,
            minimum: 0.25,
            maximum: 0.75,
        });
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.05, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 61, 0.25, 1)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 62, 1.0, 2)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 60,
                    velocity: 0.25,
                    at_sample: 0,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 61,
                    velocity: 0.6,
                    at_sample: 1,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 62,
                    velocity: 0.75,
                    at_sample: 2,
                },
            ]
        );
    }

    #[test]
    fn velocity_node_forwards_note_off_unchanged() {
        let plan = velocity_to_recording_plan(VelocityNodePlan {
            multiplier: 0.0,
            offset: 1.0,
            minimum: 0.0,
            maximum: 1.0,
        });
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 64, 456)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOff {
                target_node: NODE_EVENT_INPUT,
                note: 64,
                at_sample: 456,
            }]
        );
    }

    #[test]
    fn velocity_node_rejects_invalid_transform_configuration() {
        for velocity in [
            VelocityNodePlan {
                multiplier: f32::NAN,
                offset: 0.0,
                minimum: 0.0,
                maximum: 1.0,
            },
            VelocityNodePlan {
                multiplier: -1.0,
                offset: 0.0,
                minimum: 0.0,
                maximum: 1.0,
            },
            VelocityNodePlan {
                multiplier: 1.0,
                offset: f32::INFINITY,
                minimum: 0.0,
                maximum: 1.0,
            },
            VelocityNodePlan {
                multiplier: 1.0,
                offset: 0.0,
                minimum: -0.1,
                maximum: 1.0,
            },
            VelocityNodePlan {
                multiplier: 1.0,
                offset: 0.0,
                minimum: 0.0,
                maximum: 1.1,
            },
            VelocityNodePlan {
                multiplier: 1.0,
                offset: 0.0,
                minimum: 0.75,
                maximum: 0.25,
            },
        ] {
            assert!(matches!(
                PreparedExecutionPlan::prepare(&velocity_to_recording_plan(velocity), 128),
                Err(PlanValidationError::InvalidVelocityTransform)
            ));
        }
    }

    #[test]
    fn velocity_transform_applies_before_chord_fanout() {
        let mut plan = chord_to_recording_plan(vec![0, 4, 7]);

        plan.nodes.insert(
            1,
            PlanNode {
                id: NODE_VELOCITY,
                kind: PlanNodeKind::Velocity(VelocityNodePlan {
                    multiplier: 0.5,
                    offset: 0.1,
                    minimum: 0.0,
                    maximum: 1.0,
                }),
            },
        );
        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
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
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 3);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.8, 99)));
        assert_eq!(
            recorded_events(&prepared, 3),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 60,
                    velocity: 0.5,
                    at_sample: 99,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 64,
                    velocity: 0.5,
                    at_sample: 99,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 67,
                    velocity: 0.5,
                    at_sample: 99,
                },
            ]
        );
    }

    #[test]
    fn chord_node_emits_major_triad_note_on_in_interval_order() {
        let plan = chord_to_recording_plan(vec![0, 4, 7]);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.75, 123)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 60,
                    velocity: 0.75,
                    at_sample: 123,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 64,
                    velocity: 0.75,
                    at_sample: 123,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 67,
                    velocity: 0.75,
                    at_sample: 123,
                },
            ]
        );

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_received, 4);
        assert_eq!(diagnostics.events_emitted, 3);
        assert_eq!(diagnostics.events_suppressed, 0);
    }

    #[test]
    fn chord_node_emits_matching_note_off_fanout() {
        let plan = chord_to_recording_plan(vec![0, 3, 7]);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 62, 456)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[
                ScheduledEngineEvent::NoteOff {
                    target_node: NODE_EVENT_INPUT,
                    note: 62,
                    at_sample: 456,
                },
                ScheduledEngineEvent::NoteOff {
                    target_node: NODE_EVENT_INPUT,
                    note: 65,
                    at_sample: 456,
                },
                ScheduledEngineEvent::NoteOff {
                    target_node: NODE_EVENT_INPUT,
                    note: 69,
                    at_sample: 456,
                },
            ]
        );
    }

    #[test]
    fn chord_node_suppresses_out_of_range_child_notes() {
        let plan = chord_to_recording_plan(vec![0, 7, 12]);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 120, 1.0, 0)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 120,
                    velocity: 1.0,
                    at_sample: 0,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 127,
                    velocity: 1.0,
                    at_sample: 0,
                },
            ]
        );
        assert_eq!(prepared.event_graph_diagnostics().events_suppressed, 1);
    }

    #[test]
    fn chord_node_rejects_empty_duplicate_and_oversized_interval_sets() {
        assert!(matches!(
            PreparedExecutionPlan::prepare(&chord_to_recording_plan(vec![]), 128),
            Err(PlanValidationError::InvalidChordIntervals)
        ));
        assert!(matches!(
            PreparedExecutionPlan::prepare(&chord_to_recording_plan(vec![0, 4, 4]), 128),
            Err(PlanValidationError::DuplicateChordInterval)
        ));
        assert!(matches!(
            PreparedExecutionPlan::prepare(
                &chord_to_recording_plan(vec![0; MAX_CHORD_INTERVALS + 1]),
                128
            ),
            Err(PlanValidationError::InvalidChordIntervals)
        ));
    }

    #[test]
    fn chord_node_allocates_instrument_voices_for_all_child_notes() {
        let mut prepared =
            PreparedExecutionPlan::prepare(&chorded_instrument_plan(vec![0, 4, 7], 4, 2), 128)
                .unwrap();

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 3);
        assert_eq!(instrument_diagnostics(&prepared).peak_active_voices, 3);

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 60, 128)));

        assert_eq!(instrument_diagnostics(&prepared).active_voices, 0);
    }

    #[test]
    fn transpose_scale_and_chord_compose_predictably() {
        let mut plan = chord_to_recording_plan(vec![0, 4, 7]);

        plan.nodes.insert(
            1,
            PlanNode {
                id: NODE_TRANSPOSE,
                kind: PlanNodeKind::Transpose(TransposeNodePlan { semitones: 2 }),
            },
        );
        plan.nodes.insert(
            2,
            PlanNode {
                id: NODE_SCALE,
                kind: PlanNodeKind::Scale(ScaleNodePlan {
                    root_note: 60,
                    pitch_class_mask: ScaleNodePlan::MAJOR_MASK,
                }),
            },
        );
        plan.event_routes = vec![
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
                destination: event_endpoint(NODE_CHORD),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: event_endpoint(NODE_CHORD),
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 4);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 99)));
        assert_eq!(
            recorded_events(&prepared, 4),
            &[
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 62,
                    velocity: 0.5,
                    at_sample: 99,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 66,
                    velocity: 0.5,
                    at_sample: 99,
                },
                ScheduledEngineEvent::NoteOn {
                    target_node: NODE_EVENT_INPUT,
                    note: 69,
                    velocity: 0.5,
                    at_sample: 99,
                },
            ]
        );
    }

    #[test]
    fn scale_node_passes_in_scale_note_on_unchanged() {
        let plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.8, 321)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 64,
                velocity: 0.8,
                at_sample: 321,
            }]
        );

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_received, 2);
        assert_eq!(diagnostics.events_emitted, 1);
        assert_eq!(diagnostics.events_suppressed, 0);
    }

    #[test]
    fn scale_helper_leaves_rejected_output_unconnected() {
        let plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 61, 0.8, 321)));
        assert!(recorded_events(&prepared, 2).is_empty());

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_emitted, 1);
        assert_eq!(diagnostics.events_suppressed, 0);
    }

    #[test]
    fn scale_node_applies_same_policy_to_note_off() {
        let plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 67, 100)));
        assert!(prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 70, 120)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOff {
                target_node: NODE_EVENT_INPUT,
                note: 67,
                at_sample: 100,
            }]
        );

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_emitted, 2);
        assert_eq!(diagnostics.events_suppressed, 0);
    }

    #[test]
    fn scale_node_routes_accepted_notes_from_accepted_output() {
        let mut plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);

        plan.event_routes[1].source.port_id = SCALE_PORT_ACCEPTED;

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.8, 321)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 64,
                velocity: 0.8,
                at_sample: 321,
            }]
        );
    }

    #[test]
    fn scale_node_routes_rejected_notes_from_rejected_output() {
        let mut plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);

        plan.event_routes[1].source.port_id = SCALE_PORT_REJECTED;

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 61, 0.8, 321)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 61,
                velocity: 0.8,
                at_sample: 321,
            }]
        );
    }

    #[test]
    fn scale_outputs_can_route_to_different_destinations() {
        let mut plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);

        plan.nodes.insert(
            3,
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count: 4,
                    attack_seconds: 0.0,
                    decay_seconds: 0.0,
                    sustain_level: 1.0,
                    release_seconds: 0.0,
                }),
            },
        );
        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_SCALE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: EventEndpoint {
                    node_id: NODE_SCALE,
                    port_id: SCALE_PORT_ACCEPTED,
                },
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: EventEndpoint {
                    node_id: NODE_SCALE,
                    port_id: SCALE_PORT_REJECTED,
                },
                destination: event_endpoint(NODE_INSTRUMENT),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();
        install_recording_node(&mut prepared, 2);
        install_recording_node(&mut prepared, 3);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.8, 10)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 61, 0.4, 11)));

        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 64,
                velocity: 0.8,
                at_sample: 10,
            }]
        );
        assert_eq!(
            recorded_events(&prepared, 3),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 61,
                velocity: 0.4,
                at_sample: 11,
            }]
        );

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_emitted, 2);
        assert_eq!(diagnostics.events_suppressed, 0);
    }

    #[test]
    fn scale_output_priority_is_deterministic_per_port() {
        let mut plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);

        plan.nodes.insert(
            3,
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count: 4,
                    attack_seconds: 0.0,
                    decay_seconds: 0.0,
                    sustain_level: 1.0,
                    release_seconds: 0.0,
                }),
            },
        );
        plan.event_routes = vec![
            EventRoute {
                source: event_endpoint(NODE_EVENT_INPUT),
                destination: event_endpoint(NODE_SCALE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source: EventEndpoint {
                    node_id: NODE_SCALE,
                    port_id: SCALE_PORT_ACCEPTED,
                },
                destination: event_endpoint(NODE_INSTRUMENT),
                event_mask: EventRouteMask::NOTE,
                priority: 20,
                enabled: true,
            },
            EventRoute {
                source: EventEndpoint {
                    node_id: NODE_SCALE,
                    port_id: SCALE_PORT_ACCEPTED,
                },
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 10,
                enabled: true,
            },
            EventRoute {
                source: EventEndpoint {
                    node_id: NODE_SCALE,
                    port_id: SCALE_PORT_REJECTED,
                },
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 5,
                enabled: true,
            },
        ];

        let prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert_eq!(
            prepared.event_route_range_for_source_endpoint(NODE_SCALE, SCALE_PORT_ACCEPTED),
            Some((1, 2))
        );
        assert_eq!(
            prepared.event_route_range_for_source_endpoint(NODE_SCALE, SCALE_PORT_REJECTED),
            Some((3, 1))
        );
        assert_eq!(prepared.event_route_destination_at(1), Some(2));
        assert_eq!(prepared.event_route_destination_at(2), Some(3));
        assert_eq!(prepared.event_route_destination_at(3), Some(2));
    }

    #[test]
    fn unknown_scale_output_port_rejects_during_compilation() {
        let mut plan = scale_to_recording_plan(60, ScaleNodePlan::MAJOR_MASK);

        plan.event_routes[1].source.port_id = 99;

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::UnknownEventSourcePort)
        ));
    }

    #[test]
    fn transpose_then_scale_can_suppress_transformed_notes() {
        let mut plan = transpose_to_recording_plan(1);

        plan.nodes.insert(
            2,
            PlanNode {
                id: NODE_SCALE,
                kind: PlanNodeKind::Scale(ScaleNodePlan {
                    root_note: 60,
                    pitch_class_mask: ScaleNodePlan::MAJOR_MASK,
                }),
            },
        );
        plan.event_routes = vec![
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
                destination: event_endpoint(NODE_VOICE),
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
        ];

        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 3);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 99)));
        assert!(recorded_events(&prepared, 3).is_empty());

        let diagnostics = prepared.event_graph_diagnostics();

        assert_eq!(diagnostics.events_emitted, 2);
        assert_eq!(diagnostics.events_suppressed, 0);
    }

    #[test]
    fn scale_root_changes_accepted_pitch_classes() {
        let plan = scale_to_recording_plan(62, ScaleNodePlan::MAJOR_MASK);
        let mut prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        install_recording_node(&mut prepared, 2);

        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 62, 0.5, 0)));
        assert_eq!(
            recorded_events(&prepared, 2),
            &[ScheduledEngineEvent::NoteOn {
                target_node: NODE_EVENT_INPUT,
                note: 62,
                velocity: 0.5,
                at_sample: 0,
            }]
        );
    }

    #[test]
    fn rejects_duplicate_node_ids() {
        let mut plan = diagnostic_tone_plan(440.0, 0.05, 2);
        plan.nodes[1].id = plan.nodes[0].id;

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::DuplicateNodeId)
        ));
    }

    #[test]
    fn rejects_unknown_execution_order_node() {
        let mut plan = diagnostic_tone_plan(440.0, 0.05, 2);
        plan.audio_execution_order.push(99);

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::UnknownNode)
        ));
    }

    #[test]
    fn rejects_unknown_buffer() {
        let mut plan = diagnostic_tone_plan(440.0, 0.05, 2);
        plan.nodes[0].kind = PlanNodeKind::Oscillator(OscillatorNodePlan {
            frequency_parameter: 1,
            output_buffer: 99,
        });

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::UnknownBuffer)
        ));
    }

    #[test]
    fn rejects_unknown_parameter() {
        let mut plan = diagnostic_tone_plan(440.0, 0.05, 2);
        plan.nodes[1].kind = PlanNodeKind::Gain(GainNodePlan {
            gain_parameter: 99,
            input_buffer: 1,
            output_buffer: 2,
        });

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::UnknownParameter)
        ));
    }

    #[test]
    fn rejects_unsupported_node_type() {
        let mut plan = diagnostic_tone_plan(440.0, 0.05, 2);
        plan.nodes[1].kind = PlanNodeKind::Unsupported { descriptor: 42 };

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::UnsupportedNodeType)
        ));
    }

    #[test]
    fn rejects_missing_output() {
        let plan = NativeExecutionPlan {
            version: NATIVE_EXECUTION_PLAN_VERSION,
            plan_id: 1,
            plan_revision: 1,
            nodes: vec![
                PlanNode {
                    id: NODE_OSCILLATOR,
                    kind: PlanNodeKind::Oscillator(OscillatorNodePlan {
                        frequency_parameter: 1,
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
            ],
            buffers: vec![
                AudioBufferSlot { id: 1, channels: 1 },
                AudioBufferSlot { id: 2, channels: 1 },
            ],
            parameters: diagnostic_tone_plan(440.0, 0.05, 2).parameters,
            event_routes: vec![],
            audio_execution_order: vec![NODE_OSCILLATOR, NODE_GAIN],
        };

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::MissingOutput)
        ));
    }

    #[test]
    fn rejects_multiple_outputs() {
        let mut plan = diagnostic_tone_plan(440.0, 0.05, 2);
        plan.nodes.push(PlanNode {
            id: 99,
            kind: PlanNodeKind::Output(OutputNodePlan {
                input_buffer: 2,
                output_channels: 2,
            }),
        });
        plan.audio_execution_order.push(99);

        assert!(matches!(
            PreparedExecutionPlan::prepare(&plan, 128),
            Err(PlanValidationError::MultipleOutputs)
        ));
    }

    #[test]
    fn transfers_matching_oscillator_phase_and_gain_smoother_state() {
        let old_plan = diagnostic_tone_plan(440.0, 0.0, 2);
        let new_plan = diagnostic_tone_plan(440.0, 0.0, 2);
        let mut old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let mut output = vec![0.0; 128 * 2];

        old_prepared.set_parameter(PARAM_GAIN_GAIN, 1.0, 128);
        old_prepared.process(
            &mut output,
            48_000.0,
            2,
            ProcessRange {
                start_frame: 0,
                end_frame: 64,
            },
        );

        let transfer = PlanStateTransfer {
            entries: vec![
                StateTransferEntry {
                    old_node_index: 0,
                    new_node_index: 0,
                    kind: StateTransferKind::OscillatorPhase,
                },
                StateTransferEntry {
                    old_node_index: 1,
                    new_node_index: 1,
                    kind: StateTransferKind::GainSmoother,
                },
            ]
            .into_boxed_slice(),
        };

        new_prepared
            .apply_state_transfer_from(&old_prepared, &transfer)
            .unwrap();

        assert_eq!(
            new_prepared.nodes[0].oscillator_phase(),
            old_prepared.nodes[0].oscillator_phase()
        );
        assert_eq!(
            new_prepared.parameters[1].smoother.state(),
            old_prepared.parameters[1].smoother.state()
        );
    }

    #[test]
    fn transfers_matching_instrument_pool_state() {
        let mut old_plan = instrument_plan_with_voice_count(2);
        let mut new_plan = instrument_plan_with_voice_count(2);

        set_instrument_release(&mut old_plan, 1.0);
        set_instrument_release(&mut new_plan, 1.0);

        let mut old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let mut output = vec![0.0; 64 * 2];

        assert!(old_prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(old_prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.75, 0)));
        assert!(old_prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 60, 0)));
        old_prepared.process(
            &mut output,
            48_000.0,
            2,
            ProcessRange {
                start_frame: 0,
                end_frame: 32,
            },
        );

        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert_eq!(
            transfer.entries.as_ref(),
            &[StateTransferEntry {
                old_node_index: 1,
                new_node_index: 1,
                kind: StateTransferKind::InstrumentPool,
            }]
        );

        new_prepared
            .apply_state_transfer_from(&old_prepared, &transfer)
            .unwrap();

        let old_instrument = instrument_node(&old_prepared);
        let new_instrument = instrument_node(&new_prepared);

        assert_eq!(
            new_instrument.allocation_sequence,
            old_instrument.allocation_sequence
        );
        assert_eq!(
            new_instrument.release_sequence,
            old_instrument.release_sequence
        );
        assert_eq!(
            new_instrument
                .voices
                .iter()
                .map(InstrumentVoice::state)
                .collect::<Vec<_>>(),
            old_instrument
                .voices
                .iter()
                .map(InstrumentVoice::state)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn transferred_instrument_preserves_deterministic_stealing_order() {
        let old_plan = instrument_plan_with_voice_count(2);
        let new_plan = instrument_plan_with_voice_count(2);
        let mut old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert!(old_prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 60, 0.5, 0)));
        assert!(old_prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 64, 0.5, 0)));

        new_prepared
            .apply_state_transfer_from(&old_prepared, &transfer)
            .unwrap();

        assert!(new_prepared.dispatch_event(note_on(NODE_EVENT_INPUT, 67, 0.5, 0)));
        assert!(new_prepared.dispatch_event(note_off(NODE_EVENT_INPUT, 60, 0)));

        assert_eq!(instrument_diagnostics(&new_prepared).active_voices, 2);
        assert_eq!(instrument_diagnostics(&new_prepared).voice_steals, 1);
    }

    #[test]
    fn rejects_invalid_state_transfer_maps() {
        let old_plan = diagnostic_tone_plan(440.0, 0.0, 2);
        let new_plan = diagnostic_tone_plan(440.0, 0.0, 2);
        let old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();

        let unknown_old = PlanStateTransfer {
            entries: vec![StateTransferEntry {
                old_node_index: 99,
                new_node_index: 0,
                kind: StateTransferKind::OscillatorPhase,
            }]
            .into_boxed_slice(),
        };
        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &unknown_old),
            Err(StateTransferError::UnknownOldNode)
        );

        let unknown_new = PlanStateTransfer {
            entries: vec![StateTransferEntry {
                old_node_index: 0,
                new_node_index: 99,
                kind: StateTransferKind::OscillatorPhase,
            }]
            .into_boxed_slice(),
        };
        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &unknown_new),
            Err(StateTransferError::UnknownNewNode)
        );

        let node_type_mismatch = PlanStateTransfer {
            entries: vec![StateTransferEntry {
                old_node_index: 0,
                new_node_index: 1,
                kind: StateTransferKind::OscillatorPhase,
            }]
            .into_boxed_slice(),
        };
        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &node_type_mismatch),
            Err(StateTransferError::NodeTypeMismatch)
        );

        let incompatible_kind = PlanStateTransfer {
            entries: vec![StateTransferEntry {
                old_node_index: 0,
                new_node_index: 0,
                kind: StateTransferKind::GainSmoother,
            }]
            .into_boxed_slice(),
        };
        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &incompatible_kind),
            Err(StateTransferError::IncompatibleTransferKind)
        );

        let duplicate_old = PlanStateTransfer {
            entries: vec![
                StateTransferEntry {
                    old_node_index: 0,
                    new_node_index: 0,
                    kind: StateTransferKind::OscillatorPhase,
                },
                StateTransferEntry {
                    old_node_index: 0,
                    new_node_index: 1,
                    kind: StateTransferKind::GainSmoother,
                },
            ]
            .into_boxed_slice(),
        };
        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &duplicate_old),
            Err(StateTransferError::DuplicateOldNode)
        );

        let duplicate_new = PlanStateTransfer {
            entries: vec![
                StateTransferEntry {
                    old_node_index: 0,
                    new_node_index: 0,
                    kind: StateTransferKind::OscillatorPhase,
                },
                StateTransferEntry {
                    old_node_index: 1,
                    new_node_index: 0,
                    kind: StateTransferKind::GainSmoother,
                },
            ]
            .into_boxed_slice(),
        };
        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &duplicate_new),
            Err(StateTransferError::DuplicateNewNode)
        );

        let old_instrument =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(1), 128).unwrap();
        let mut new_instrument =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(2), 128).unwrap();
        let incompatible_pool = PlanStateTransfer {
            entries: vec![StateTransferEntry {
                old_node_index: 1,
                new_node_index: 1,
                kind: StateTransferKind::InstrumentPool,
            }]
            .into_boxed_slice(),
        };

        assert_eq!(
            new_instrument.apply_state_transfer_from(&old_instrument, &incompatible_pool),
            Err(StateTransferError::IncompatibleInstrumentPool)
        );
    }

    fn metadata(nodes: &[(u64, u32, RuntimeNodeKind)]) -> PreparedExecutionPlanMetadata {
        PreparedExecutionPlanMetadata {
            nodes: nodes
                .iter()
                .copied()
                .map(
                    |(stable_id, runtime_index, node_kind)| RuntimeNodeMetadata {
                        stable_id,
                        runtime_index,
                        node_kind,
                        instrument: None,
                        arpeggiator: None,
                    },
                )
                .collect::<Vec<_>>()
                .into_boxed_slice(),
        }
    }

    #[test]
    fn builds_state_transfer_for_matching_oscillator_and_gain_ids() {
        let old_plan = diagnostic_tone_plan(440.0, 0.0, 2);
        let new_plan = diagnostic_tone_plan(880.0, 0.5, 2);
        let old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();

        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert_eq!(
            transfer.entries.as_ref(),
            &[
                StateTransferEntry {
                    old_node_index: 0,
                    new_node_index: 0,
                    kind: StateTransferKind::OscillatorPhase,
                },
                StateTransferEntry {
                    old_node_index: 1,
                    new_node_index: 1,
                    kind: StateTransferKind::GainSmoother,
                },
            ]
        );
    }

    #[test]
    fn builds_state_transfer_for_matching_instrument_pool_ids() {
        let old_prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();
        let new_prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(4), 128).unwrap();

        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert_eq!(
            transfer.entries.as_ref(),
            &[StateTransferEntry {
                old_node_index: 1,
                new_node_index: 1,
                kind: StateTransferKind::InstrumentPool,
            }]
        );
    }

    #[test]
    fn state_transfer_planner_rejects_incompatible_instrument_pools() {
        let old_prepared =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(2), 128).unwrap();
        let mut new_plan = instrument_plan_with_voice_count(2);

        set_instrument_release(&mut new_plan, 0.5);

        let new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();

        assert_eq!(
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()),
            Err(StateTransferPlanningError::IncompatibleInstrumentPool {
                stable_id: NODE_INSTRUMENT as u64
            })
        );

        let different_voice_count =
            PreparedExecutionPlan::prepare(&instrument_plan_with_voice_count(3), 128).unwrap();

        assert_eq!(
            build_state_transfer(&old_prepared.metadata(), &different_voice_count.metadata()),
            Err(StateTransferPlanningError::IncompatibleInstrumentPool {
                stable_id: NODE_INSTRUMENT as u64
            })
        );
    }

    #[test]
    fn state_transfer_planner_rejects_same_id_with_changed_node_type() {
        let old_metadata = metadata(&[(1, 0, RuntimeNodeKind::Oscillator)]);
        let new_metadata = metadata(&[(1, 0, RuntimeNodeKind::Gain)]);

        assert_eq!(
            build_state_transfer(&old_metadata, &new_metadata),
            Err(StateTransferPlanningError::NodeTypeChanged { stable_id: 1 })
        );
    }

    #[test]
    fn state_transfer_planner_ignores_renamed_removed_new_and_output_nodes() {
        let old_metadata = metadata(&[
            (1, 0, RuntimeNodeKind::Oscillator),
            (2, 1, RuntimeNodeKind::Gain),
            (3, 2, RuntimeNodeKind::Output),
            (4, 3, RuntimeNodeKind::Gain),
        ]);
        let new_metadata = metadata(&[
            (10, 0, RuntimeNodeKind::Oscillator),
            (2, 1, RuntimeNodeKind::Gain),
            (3, 2, RuntimeNodeKind::Output),
            (5, 3, RuntimeNodeKind::Gain),
        ]);

        let transfer = build_state_transfer(&old_metadata, &new_metadata).unwrap();

        assert_eq!(
            transfer.entries.as_ref(),
            &[StateTransferEntry {
                old_node_index: 1,
                new_node_index: 1,
                kind: StateTransferKind::GainSmoother,
            }]
        );
    }

    #[test]
    fn state_transfer_planner_output_is_deterministic_regardless_of_metadata_ordering() {
        let old_metadata = metadata(&[
            (2, 7, RuntimeNodeKind::Gain),
            (1, 9, RuntimeNodeKind::Oscillator),
            (3, 5, RuntimeNodeKind::Output),
        ]);
        let new_metadata = metadata(&[
            (3, 6, RuntimeNodeKind::Output),
            (2, 4, RuntimeNodeKind::Gain),
            (1, 8, RuntimeNodeKind::Oscillator),
        ]);

        let transfer = build_state_transfer(&old_metadata, &new_metadata).unwrap();

        assert_eq!(
            transfer.entries.as_ref(),
            &[
                StateTransferEntry {
                    old_node_index: 9,
                    new_node_index: 8,
                    kind: StateTransferKind::OscillatorPhase,
                },
                StateTransferEntry {
                    old_node_index: 7,
                    new_node_index: 4,
                    kind: StateTransferKind::GainSmoother,
                },
            ]
        );
    }

    #[test]
    fn state_transfer_planner_rejects_duplicate_stable_ids() {
        let old_metadata = metadata(&[
            (1, 0, RuntimeNodeKind::Oscillator),
            (1, 1, RuntimeNodeKind::Gain),
        ]);
        let new_metadata = metadata(&[(1, 0, RuntimeNodeKind::Oscillator)]);

        assert_eq!(
            build_state_transfer(&old_metadata, &new_metadata),
            Err(StateTransferPlanningError::DuplicateOldStableId)
        );

        let old_metadata = metadata(&[(1, 0, RuntimeNodeKind::Oscillator)]);
        let new_metadata = metadata(&[
            (1, 0, RuntimeNodeKind::Oscillator),
            (1, 1, RuntimeNodeKind::Gain),
        ]);

        assert_eq!(
            build_state_transfer(&old_metadata, &new_metadata),
            Err(StateTransferPlanningError::DuplicateNewStableId)
        );
    }

    #[test]
    fn generated_state_transfer_passes_runtime_validator() {
        let old_plan = diagnostic_tone_plan(440.0, 0.0, 2);
        let new_plan = diagnostic_tone_plan(880.0, 0.5, 2);
        let old_prepared = PreparedExecutionPlan::prepare(&old_plan, 128).unwrap();
        let mut new_prepared = PreparedExecutionPlan::prepare(&new_plan, 128).unwrap();
        let transfer =
            build_state_transfer(&old_prepared.metadata(), &new_prepared.metadata()).unwrap();

        assert_eq!(
            new_prepared.apply_state_transfer_from(&old_prepared, &transfer),
            Ok(())
        );
    }
}
