use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
};

use engine_protocol::{EngineCommand, EngineEvent};

pub const COMMAND_QUEUE_CAPACITY: usize = 1024;
pub const TELEMETRY_QUEUE_CAPACITY: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueuePushError {
    Full,
}

struct RealtimeQueue<T: Send, const N: usize> {
    buffer: Box<[UnsafeCell<MaybeUninit<T>>]>,
    head: AtomicUsize,
    tail: AtomicUsize,
    overflow_count: AtomicU64,
}

unsafe impl<T: Send, const N: usize> Send for RealtimeQueue<T, N> {}
unsafe impl<T: Send, const N: usize> Sync for RealtimeQueue<T, N> {}

impl<T: Send, const N: usize> RealtimeQueue<T, N> {
    fn new() -> Self {
        assert!(N > 1, "realtime queue capacity must be greater than one");

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

    fn push(&self, value: T) -> Result<(), QueuePushError> {
        let head = self.head.load(Ordering::Relaxed);
        let next_head = (head + 1) % N;

        if next_head == self.tail.load(Ordering::Acquire) {
            self.overflow_count.fetch_add(1, Ordering::Relaxed);
            return Err(QueuePushError::Full);
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

    fn len(&self) -> usize {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        if head >= tail {
            head - tail
        } else {
            N - tail + head
        }
    }

    fn overflow_count(&self) -> u64 {
        self.overflow_count.load(Ordering::Relaxed)
    }
}

impl<T: Send, const N: usize> Drop for RealtimeQueue<T, N> {
    fn drop(&mut self) {
        while self.pop().is_some() {}
    }
}

pub struct EngineCommandSender {
    queue: Arc<RealtimeQueue<EngineCommand, COMMAND_QUEUE_CAPACITY>>,
}

pub struct EngineCommandReceiver {
    queue: Arc<RealtimeQueue<EngineCommand, COMMAND_QUEUE_CAPACITY>>,
}

pub struct EngineTelemetrySender {
    queue: Arc<RealtimeQueue<EngineEvent, TELEMETRY_QUEUE_CAPACITY>>,
}

pub struct EngineTelemetryReceiver {
    queue: Arc<RealtimeQueue<EngineEvent, TELEMETRY_QUEUE_CAPACITY>>,
}

pub fn engine_command_queue() -> (EngineCommandSender, EngineCommandReceiver) {
    let queue = Arc::new(RealtimeQueue::new());

    (
        EngineCommandSender {
            queue: queue.clone(),
        },
        EngineCommandReceiver { queue },
    )
}

pub fn engine_telemetry_queue() -> (EngineTelemetrySender, EngineTelemetryReceiver) {
    let queue = Arc::new(RealtimeQueue::new());

    (
        EngineTelemetrySender {
            queue: queue.clone(),
        },
        EngineTelemetryReceiver { queue },
    )
}

impl EngineCommandSender {
    pub fn push(&self, command: EngineCommand) -> Result<(), QueuePushError> {
        self.queue.push(command)
    }

    pub fn overflow_count(&self) -> u64 {
        self.queue.overflow_count()
    }
}

impl EngineCommandReceiver {
    pub fn pop(&self) -> Option<EngineCommand> {
        self.queue.pop()
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn overflow_count(&self) -> u64 {
        self.queue.overflow_count()
    }
}

impl EngineTelemetrySender {
    pub fn push(&self, event: EngineEvent) -> Result<(), QueuePushError> {
        self.queue.push(event)
    }

    pub fn overflow_count(&self) -> u64 {
        self.queue.overflow_count()
    }
}

impl EngineTelemetryReceiver {
    pub fn pop(&self) -> Option<EngineEvent> {
        self.queue.pop()
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn overflow_count(&self) -> u64 {
        self.queue.overflow_count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_overflow_without_blocking() {
        let (sender, receiver) = engine_command_queue();
        let mut overflowed = false;

        for index in 0..COMMAND_QUEUE_CAPACITY {
            let result = sender.push(EngineCommand::Panic {
                id: index as u64,
                at_sample: 0,
            });

            overflowed |= result == Err(QueuePushError::Full);
        }

        assert!(overflowed);
        assert_eq!(sender.overflow_count(), 1);
        assert!(receiver.pop().is_some());
    }
}
