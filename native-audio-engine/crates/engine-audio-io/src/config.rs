#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioSampleFormat {
    F32,
    I16,
    U16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputStreamRequest {
    pub device_id: Option<String>,
    pub preferred_sample_rate: Option<u32>,
    pub preferred_buffer_frames: Option<u32>,
    pub preferred_channels: Option<u16>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveOutputStream {
    pub device_id: String,
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: AudioSampleFormat,
    pub requested_buffer_frames: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioDriverEvent {
    StreamError { code: AudioDriverErrorCode },
    StreamStarted { sample_rate: u32, channels: u16 },
    StreamStopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioDriverErrorCode {
    BuildStream,
    DeviceUnavailable,
    PlayStream,
    StreamRuntime,
    UnsupportedSampleFormat,
}
