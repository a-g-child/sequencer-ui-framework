use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
};

use engine_dsp::SmoothedParameter;
use engine_protocol::{
    AudioBufferSlot, BufferSlotId, NativeExecutionPlan, NodeId, ParameterSlotId, PlanNodeKind,
    NATIVE_EXECUTION_PLAN_VERSION,
};

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
    Gain(GainNode),
    Output(OutputNode),
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
            Self::Gain(node) => node.process(context, buffers, parameters),
            Self::Output(node) => node.process(context, buffers, output),
        }
    }

    fn reset(&mut self) {
        if let Self::Oscillator(node) = self {
            node.phase = 0.0;
        }
    }

    fn node_type(&self) -> RuntimeNodeKind {
        match self {
            Self::Oscillator(_) => RuntimeNodeKind::Oscillator,
            Self::Gain(_) => RuntimeNodeKind::Gain,
            Self::Output(_) => RuntimeNodeKind::Output,
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
}

struct OscillatorNode {
    phase: f64,
    frequency_parameter: usize,
    output_buffer: usize,
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
        diagnostic_tone_plan, AudioBufferSlot, GainNodePlan, NativeExecutionPlan,
        OscillatorNodePlan, OutputNodePlan, PlanNode, PlanNodeKind, NODE_GAIN, NODE_OSCILLATOR,
        PARAM_GAIN_GAIN,
    };

    #[test]
    fn prepares_valid_diagnostic_plan() {
        let plan = diagnostic_tone_plan(440.0, 0.05, 2);
        let prepared = PreparedExecutionPlan::prepare(&plan, 128).unwrap();

        assert_eq!(prepared.output_node_count(), 1);
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
