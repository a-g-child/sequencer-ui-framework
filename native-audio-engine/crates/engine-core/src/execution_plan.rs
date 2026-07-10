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
    output_node_count: usize,
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

        Ok(Self {
            plan_id: plan.plan_id,
            plan_revision: plan.plan_revision,
            nodes,
            buffers,
            parameters,
            execution_order,
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
        let context = NodeProcessContext {
            sample_rate,
            output_channels,
            range,
        };

        for node_index in self.execution_order.iter().copied() {
            let node = &mut self.nodes[node_index];

            node.process(&context, &mut self.buffers, &mut self.parameters, output);
        }
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

    pub fn maximum_frames(&self) -> usize {
        self.buffers.maximum_frames
    }

    pub fn plan_id(&self) -> u64 {
        self.plan_id
    }

    pub fn plan_revision(&self) -> u64 {
        self.plan_revision
    }
}

pub const PREPARED_PLAN_TRANSFER_CAPACITY: usize = 4;
pub const RETIRED_PLAN_TRANSFER_CAPACITY: usize = 4;

pub struct PreparedPlanTransfer {
    pub transfer_id: u64,
    pub plan_id: u64,
    pub plan_revision: u64,
    pub plan: PreparedExecutionPlan,
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
}
