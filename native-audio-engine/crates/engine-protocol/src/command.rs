#[derive(Clone, Copy, Debug, PartialEq)]
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
}

impl EngineCommand {
    pub fn id(&self) -> u64 {
        match *self {
            Self::TransportStart { id, .. }
            | Self::TransportStop { id, .. }
            | Self::Panic { id, .. }
            | Self::SetParameter { id, .. } => id,
        }
    }

    pub fn at_sample(&self) -> u64 {
        match *self {
            Self::TransportStart { at_sample, .. }
            | Self::TransportStop { at_sample, .. }
            | Self::Panic { at_sample, .. }
            | Self::SetParameter { at_sample, .. } => at_sample,
        }
    }
}
