use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
};

use engine_dsp::{MonophonicVoice, SmoothedParameter};
use engine_protocol::{
    AudioBufferSlot, BufferSlotId, EventGraphDiagnostics, EventRouteMask, NativeExecutionPlan,
    NodeId, ParameterSlotId, PlanNodeKind, ScheduledEngineEvent, NATIVE_EXECUTION_PLAN_VERSION,
};

pub const MAX_EVENT_DEPTH: u16 = 32;
pub const MAX_EVENTS_PER_BLOCK: usize = 1024;

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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateTransferError {
    UnknownOldNode,
    UnknownNewNode,
    NodeTypeMismatch,
    IncompatibleTransferKind,
    DuplicateOldNode,
    DuplicateNewNode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateTransferPlanningError {
    DuplicateOldStableId,
    DuplicateNewStableId,
    NodeTypeChanged { stable_id: u64 },
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedExecutionPlanMetadata {
    pub nodes: Box<[RuntimeNodeMetadata]>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RuntimeNodeMetadata {
    pub stable_id: u64,
    pub runtime_index: u32,
    pub node_kind: RuntimeNodeKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeNodeKind {
    Oscillator,
    Voice,
    Gain,
    Output,
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
}

impl PreparedExecutionPlan {
    pub fn prepare(
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

                    Ok(RuntimeNode::Voice(VoiceNode {
                        voice: MonophonicVoice::new(
                            node_plan.attack_seconds,
                            node_plan.decay_seconds,
                            node_plan.sustain_level,
                            node_plan.release_seconds,
                        ),
                        output_buffer,
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

        self.event_work_queue.clear();
        self.event_work_queue
            .push(EmittedRuntimeEvent {
                source_node_index,
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
                .route_range(runtime_event.source_node_index);

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
                    source_node_index: route.destination_node_index,
                    parent_depth: runtime_event.depth,
                    diagnostics: &mut self.event_graph_diagnostics,
                };

                handled |= self.nodes[route.destination_node_index as usize]
                    .process_event(&runtime_event.event, &mut emitter);
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

    pub fn event_route_range_for_source(&self, source_node: NodeId) -> Option<(u32, u32)> {
        let source_node_index = self.event_graph.source_node_index(source_node)?;
        let range = self.event_graph.route_range(source_node_index);

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
    Oscillator(OscillatorNode),
    Voice(VoiceNode),
    Gain(GainNode),
    Output(OutputNode),
    #[cfg(test)]
    Forwarding(ForwardingNode),
    #[cfg(test)]
    Burst(BurstNode),
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
            Self::Oscillator(node) => node.process(context, buffers, parameters),
            Self::Voice(node) => node.process(context, buffers),
            Self::Gain(node) => node.process(context, buffers, parameters),
            Self::Output(node) => node.process(context, buffers, output),
            #[cfg(test)]
            Self::Forwarding(_) | Self::Burst(_) => {}
        }
    }

    fn reset(&mut self) {
        match self {
            Self::Oscillator(node) => node.phase = 0.0,
            Self::Voice(node) => node.voice.panic(),
            _ => {}
        }
    }

    fn node_type(&self) -> RuntimeNodeKind {
        match self {
            Self::Oscillator(_) => RuntimeNodeKind::Oscillator,
            Self::Voice(_) => RuntimeNodeKind::Voice,
            Self::Gain(_) => RuntimeNodeKind::Gain,
            Self::Output(_) => RuntimeNodeKind::Output,
            #[cfg(test)]
            Self::Forwarding(_) | Self::Burst(_) => RuntimeNodeKind::Gain,
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

    fn process_event(
        &mut self,
        event: &ScheduledEngineEvent,
        emitter: &mut EventEmitter<'_>,
    ) -> bool {
        match self {
            Self::Voice(node) => node.process_event(event, emitter),
            #[cfg(test)]
            Self::Forwarding(node) => node.process_event(event, emitter),
            #[cfg(test)]
            Self::Burst(node) => node.process_event(event, emitter),
            _ => false,
        }
    }
}

struct OscillatorNode {
    phase: f64,
    frequency_parameter: usize,
    output_buffer: usize,
}

struct VoiceNode {
    voice: MonophonicVoice,
    output_buffer: usize,
}

impl VoiceNode {
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

                let source_node_index = node_index(plan, route.source_node)? as u32;
                let destination_node_index = node_index(plan, route.destination_node)? as u32;

                Ok(SortableEventRoute {
                    source_node_index,
                    destination_node: route.destination_node,
                    route: PreparedEventRoute {
                        destination_node_index,
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
                route.route.priority,
                route.destination_node,
                route.plan_order,
            )
        });

        let mut source_ranges = vec![RouteRange::default(); plan.nodes.len()];
        let mut routes = Vec::with_capacity(prepared_routes.len());
        let mut index = 0;

        while index < prepared_routes.len() {
            let source_node_index = prepared_routes[index].source_node_index as usize;
            let start = routes.len() as u32;

            while index < prepared_routes.len()
                && prepared_routes[index].source_node_index as usize == source_node_index
            {
                routes.push(prepared_routes[index].route);
                index += 1;
            }

            source_ranges[source_node_index] = RouteRange {
                start,
                len: routes.len() as u32 - start,
            };
        }

        Ok(Self {
            routes: routes.into_boxed_slice(),
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

    fn route_range(&self, source_node_index: u32) -> RouteRange {
        self.source_ranges
            .get(source_node_index as usize)
            .copied()
            .unwrap_or_default()
    }
}

#[derive(Clone, Copy)]
struct SortableEventRoute {
    source_node_index: u32,
    destination_node: NodeId,
    route: PreparedEventRoute,
    plan_order: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct EmittedRuntimeEvent {
    source_node_index: u32,
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
    source_node_index: u32,
    parent_depth: u16,
    diagnostics: &'a mut EventGraphDiagnostics,
}

#[allow(dead_code)]
impl EventEmitter<'_> {
    fn emit(&mut self, event: ScheduledEngineEvent) -> Result<(), ScheduledEngineEvent> {
        if self.parent_depth >= MAX_EVENT_DEPTH {
            self.diagnostics.events_dropped_depth =
                self.diagnostics.events_dropped_depth.saturating_add(1);
            return Err(event);
        }

        let runtime_event = EmittedRuntimeEvent {
            source_node_index: self.source_node_index,
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

fn runtime_node_kind(kind: &PlanNodeKind) -> Result<RuntimeNodeKind, PlanValidationError> {
    match kind {
        PlanNodeKind::Oscillator(_) => Ok(RuntimeNodeKind::Oscillator),
        PlanNodeKind::Voice(_) => Ok(RuntimeNodeKind::Voice),
        PlanNodeKind::Gain(_) => Ok(RuntimeNodeKind::Gain),
        PlanNodeKind::Output(_) => Ok(RuntimeNodeKind::Output),
        PlanNodeKind::Unsupported { .. } => Err(PlanValidationError::UnsupportedNodeType),
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
        RuntimeNodeKind::Oscillator => Some(StateTransferKind::OscillatorPhase),
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
            _ => return Err(StateTransferError::IncompatibleTransferKind),
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_protocol::{
        diagnostic_tone_plan, monophonic_voice_plan, AudioBufferSlot, EventRoute, EventRouteMask,
        GainNodePlan, NativeExecutionPlan, OscillatorNodePlan, OutputNodePlan, PlanNode,
        PlanNodeKind, ScheduledEngineEvent, NODE_GAIN, NODE_OSCILLATOR, NODE_OUTPUT, NODE_VOICE,
        PARAM_GAIN_GAIN, PARAM_OSCILLATOR_FREQUENCY,
    };

    #[test]
    fn prepares_valid_diagnostic_plan() {
        let plan = diagnostic_tone_plan(440.0, 0.05, 2);
        let prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert_eq!(prepared.output_node_count(), 1);
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

    #[test]
    fn prepared_event_graph_sorts_fanout_by_priority_then_destination() {
        let mut plan = plan_with_forwardable_event_nodes();

        plan.event_routes = vec![
            EventRoute {
                source_node: NODE_OSCILLATOR,
                destination_node: NODE_VOICE,
                event_mask: EventRouteMask::NOTE,
                priority: 20,
                enabled: true,
            },
            EventRoute {
                source_node: NODE_OSCILLATOR,
                destination_node: NODE_GAIN,
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
    fn disabled_event_routes_are_excluded_from_dispatch() {
        let mut plan = monophonic_voice_plan(2);

        plan.event_routes = vec![EventRoute {
            source_node: NODE_VOICE,
            destination_node: NODE_VOICE,
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
                source_node: NODE_OSCILLATOR,
                destination_node: NODE_GAIN,
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source_node: NODE_GAIN,
                destination_node: NODE_VOICE,
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
                source_node: NODE_OSCILLATOR,
                destination_node: NODE_GAIN,
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source_node: NODE_GAIN,
                destination_node: NODE_OSCILLATOR,
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
                source_node: NODE_OSCILLATOR,
                destination_node: NODE_GAIN,
                event_mask: EventRouteMask::NOTE,
                priority: 0,
                enabled: true,
            },
            EventRoute {
                source_node: NODE_GAIN,
                destination_node: NODE_GAIN,
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
