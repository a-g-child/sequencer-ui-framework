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
    AudioBufferSlot, BufferSlotId, EventEndpoint, EventGraphDiagnostics, EventRouteMask,
    NativeExecutionPlan, NodeId, ParameterSlotId, PlanNodeKind, ScheduledEngineEvent,
    DEFAULT_EVENT_PORT, NATIVE_EXECUTION_PLAN_VERSION, SCALE_PORT_ACCEPTED, SCALE_PORT_INPUT,
    SCALE_PORT_REJECTED,
};

pub const MAX_EVENT_DEPTH: u16 = 32;
pub const MAX_EVENTS_PER_BLOCK: usize = 1024;
pub const MAX_CHORD_INTERVALS: usize = 16;
pub const MAX_INSTRUMENT_VOICES: u16 = 128;

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
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InstrumentRuntimeMetadata {
    pub voice_count: u16,
    pub voice_config: VoiceConfig,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoiceConfig {
    pub attack_seconds: f32,
    pub decay_seconds: f32,
    pub sustain_level: f32,
    pub release_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RuntimeEventContext {
    pub input_port: u16,
    pub sample_position: u64,
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

const EMPTY_EVENT_MASK: EventRouteMask = EventRouteMask { note: false };
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
        let source_node = event_source_node(event);
        let Some(source_node_index) = self.event_graph.source_node_index(source_node) else {
            return false;
        };
        let Some(source_endpoint_index) = self
            .event_graph
            .source_endpoint_index(source_node_index, DEFAULT_EVENT_PORT)
        else {
            self.event_graph_diagnostics.events_received = self
                .event_graph_diagnostics
                .events_received
                .saturating_add(1);
            return false;
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

                let mut emitter = EventEmitter {
                    queue: &mut self.event_work_queue,
                    event_graph: &self.event_graph,
                    source_node_index: route.destination_node_index,
                    parent_input_port: route.destination_port_id,
                    parent_depth: runtime_event.depth,
                    diagnostics: &mut self.event_graph_diagnostics,
                };
                let context = RuntimeEventContext {
                    input_port: route.destination_port_id,
                    sample_position: runtime_event.event.at_sample(),
                };

                handled |= self.nodes[route.destination_node_index as usize].process_event(
                    &runtime_event.event,
                    context,
                    &mut emitter,
                );
            }
        }

        handled
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
            Self::Instrument(node) => node.panic(),
            Self::Voice(node) => node.voice.panic(),
            _ => {}
        }
    }

    fn node_type(&self) -> RuntimeNodeKind {
        match self {
            Self::EventInput(_) => RuntimeNodeKind::EventInput,
            Self::EventSplitter(_) => RuntimeNodeKind::EventSplitter,
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

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        context: RuntimeEventContext,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        match self {
            Self::EventSplitter(node) => node.process_event(event, context, emitter),
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
}

struct EventInputNode;

struct EventSplitterNode;

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
                if !route.event_mask.accepts_note() {
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

#[allow(dead_code)]
struct EventEmitter<'a> {
    queue: &'a mut FixedEventQueue,
    event_graph: &'a PreparedEventGraph,
    source_node_index: u32,
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

fn event_source_node(event: ScheduledEngineEvent) -> NodeId {
    match event {
        ScheduledEngineEvent::NoteOn { target_node, .. }
        | ScheduledEngineEvent::NoteOff { target_node, .. } => target_node,
    }
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
        monophonic_voice_plan, transposed_monophonic_voice_plan, AudioBufferSlot, ChordNodePlan,
        EventInputNodePlan, EventRoute, EventRouteMask, EventSplitterNodePlan, GainNodePlan,
        InstrumentNodePlan, NativeExecutionPlan, OscillatorNodePlan, OutputNodePlan, PlanNode,
        PlanNodeKind, ScaleNodePlan, ScheduledEngineEvent, TransposeNodePlan, VelocityNodePlan,
        DEFAULT_EVENT_PORT, NODE_CHORD, NODE_EVENT_INPUT, NODE_EVENT_SPLITTER, NODE_GAIN,
        NODE_INSTRUMENT, NODE_OSCILLATOR, NODE_OUTPUT, NODE_SCALE, NODE_TRANSPOSE, NODE_VELOCITY,
        NODE_VOICE, PARAM_GAIN_GAIN, PARAM_OSCILLATOR_FREQUENCY, SCALE_PORT_ACCEPTED,
        SCALE_PORT_REJECTED,
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
