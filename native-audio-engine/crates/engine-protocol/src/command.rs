#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TempoMapSnapshot {
    pub origin_sample: u64,
    pub origin_beat: f64,
    pub bpm: f64,
    pub sample_rate: f64,
}

impl TempoMapSnapshot {
    pub fn beat_to_sample(&self, beat: f64) -> u64 {
        let beats_from_origin = beat - self.origin_beat;
        let seconds_from_origin = beats_from_origin * 60.0 / self.bpm.max(1.0);
        let samples_from_origin = (seconds_from_origin * self.sample_rate).round();

        if samples_from_origin.is_sign_negative() {
            self.origin_sample
                .saturating_sub(samples_from_origin.abs() as u64)
        } else {
            self.origin_sample
                .saturating_add(samples_from_origin as u64)
        }
    }

    pub fn sample_to_beat(&self, sample: u64) -> f64 {
        let sample_delta = sample as i128 - self.origin_sample as i128;
        let seconds_from_origin = sample_delta as f64 / self.sample_rate.max(1.0);

        self.origin_beat + seconds_from_origin * self.bpm.max(1.0) / 60.0
    }
}

impl Default for TempoMapSnapshot {
    fn default() -> Self {
        Self {
            origin_sample: 0,
            origin_beat: 0.0,
            bpm: 120.0,
            sample_rate: 48_000.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TransportLoop {
    pub enabled: bool,
    pub start_sample: u64,
    pub end_sample: u64,
}

impl Default for TransportLoop {
    fn default() -> Self {
        Self {
            enabled: false,
            start_sample: 0,
            end_sample: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ScheduledEngineEvent {
    NoteOn {
        target_node: u32,
        note: u8,
        velocity: f32,
        at_sample: u64,
    },
    NoteOff {
        target_node: u32,
        note: u8,
        at_sample: u64,
    },
    ArpeggiatorTick {
        target_node: u32,
        generation: u64,
        at_sample: u64,
    },
}

impl ScheduledEngineEvent {
    pub fn at_sample(&self) -> u64 {
        match *self {
            Self::NoteOn { at_sample, .. }
            | Self::NoteOff { at_sample, .. }
            | Self::ArpeggiatorTick { at_sample, .. } => at_sample,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ScheduledBeatEvent {
    NoteOn {
        target_node: u32,
        note: u8,
        velocity: f32,
        at_beat: f64,
    },
    NoteOff {
        target_node: u32,
        note: u8,
        at_beat: f64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScheduledEventTraceId {
    pub clip_owner_id: u64,
    pub generation: u64,
    pub note_id: u64,
    pub role: ScheduledEventTraceRole,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScheduledEventTraceRole {
    NoteOn,
    NoteOff,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScheduledEventOwner {
    pub owner_id: u64,
    pub generation: u64,
    pub lifetime: ScheduledEventLifetime,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScheduledEventLifetime {
    GenerationBound,
    CompletionRequired,
}

impl ScheduledEventOwner {
    pub const fn generation_bound(owner_id: u64, generation: u64) -> Self {
        Self {
            owner_id,
            generation,
            lifetime: ScheduledEventLifetime::GenerationBound,
        }
    }

    pub const fn completion_required(owner_id: u64, generation: u64) -> Self {
        Self {
            owner_id,
            generation,
            lifetime: ScheduledEventLifetime::CompletionRequired,
        }
    }
}

impl ScheduledBeatEvent {
    pub fn at_beat(&self) -> f64 {
        match *self {
            Self::NoteOn { at_beat, .. } | Self::NoteOff { at_beat, .. } => at_beat,
        }
    }

    pub fn to_sample_event(&self, tempo: TempoMapSnapshot) -> ScheduledEngineEvent {
        match *self {
            Self::NoteOn {
                target_node,
                note,
                velocity,
                at_beat,
            } => ScheduledEngineEvent::NoteOn {
                target_node,
                note,
                velocity,
                at_sample: tempo.beat_to_sample(at_beat),
            },
            Self::NoteOff {
                target_node,
                note,
                at_beat,
            } => ScheduledEngineEvent::NoteOff {
                target_node,
                note,
                at_sample: tempo.beat_to_sample(at_beat),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PreparedTransportStartEvent {
    pub event: ScheduledBeatEvent,
    pub owner: ScheduledEventOwner,
    pub trace_id: Option<ScheduledEventTraceId>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EngineCommand {
    TransportStart {
        id: u64,
        at_sample: u64,
    },
    TransportStop {
        id: u64,
        at_sample: u64,
    },
    Panic {
        id: u64,
        at_sample: u64,
    },
    SetParameter {
        id: u64,
        parameter_id: u32,
        value: f32,
        at_sample: u64,
        ramp_samples: u32,
    },
    SetTempoMap {
        id: u64,
        tempo: TempoMapSnapshot,
        at_sample: u64,
    },
    SetTransportLoop {
        id: u64,
        transport_loop: TransportLoop,
        at_sample: u64,
    },
    SetScheduledEventOwnerGeneration {
        id: u64,
        owner_id: u64,
        generation: u64,
        at_sample: u64,
    },
    ScheduleEvent {
        id: u64,
        event: ScheduledEngineEvent,
    },
    ScheduleBeatEvent {
        id: u64,
        event: ScheduledBeatEvent,
        owner: Option<ScheduledEventOwner>,
        trace_id: Option<ScheduledEventTraceId>,
        at_sample: u64,
    },
    PreparedTransportStart {
        id: u64,
        at_sample: u64,
        tempo: TempoMapSnapshot,
        transport_loop: TransportLoop,
        owner_id: u64,
        generation: u64,
        events: Box<[PreparedTransportStartEvent]>,
    },
    SwapExecutionPlan {
        id: u64,
        transfer_id: u64,
        requested_sample: u64,
    },
}

impl EngineCommand {
    pub fn id(&self) -> u64 {
        match *self {
            Self::TransportStart { id, .. }
            | Self::TransportStop { id, .. }
            | Self::Panic { id, .. }
            | Self::SetParameter { id, .. }
            | Self::SetTempoMap { id, .. }
            | Self::SetTransportLoop { id, .. }
            | Self::SetScheduledEventOwnerGeneration { id, .. }
            | Self::ScheduleEvent { id, .. }
            | Self::ScheduleBeatEvent { id, .. }
            | Self::PreparedTransportStart { id, .. }
            | Self::SwapExecutionPlan { id, .. } => id,
        }
    }

    pub fn at_sample(&self) -> u64 {
        match *self {
            Self::TransportStart { at_sample, .. }
            | Self::TransportStop { at_sample, .. }
            | Self::Panic { at_sample, .. }
            | Self::SetParameter { at_sample, .. }
            | Self::SetTempoMap { at_sample, .. }
            | Self::SetTransportLoop { at_sample, .. }
            | Self::SetScheduledEventOwnerGeneration { at_sample, .. }
            | Self::ScheduleBeatEvent { at_sample, .. }
            | Self::PreparedTransportStart { at_sample, .. } => at_sample,
            Self::ScheduleEvent { event, .. } => event.at_sample(),
            Self::SwapExecutionPlan {
                requested_sample, ..
            } => requested_sample,
        }
    }
}
