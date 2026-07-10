use engine_protocol::AudioTelemetry;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StreamRequest {
    pub preferred_sample_rate: u32,
    pub preferred_buffer_frames: u32,
    pub output_channels: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActiveStreamInfo {
    pub sample_rate: u32,
    pub buffer_frames: u32,
    pub output_channels: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioIoError {
    pub message: String,
}

pub trait AudioProcessor: Send + 'static {
    fn process_interleaved(
        &mut self,
        output: &mut [f32],
        frame_count: usize,
        channels: usize,
        sample_rate: f64,
    ) -> AudioTelemetry;
}

pub trait AudioDriver {
    fn enumerate_devices(&self) -> Result<Vec<AudioDeviceInfo>, AudioIoError>;

    fn start(
        &mut self,
        requested: StreamRequest,
        processor: Box<dyn AudioProcessor>,
    ) -> Result<ActiveStreamInfo, AudioIoError>;

    fn stop(&mut self) -> Result<(), AudioIoError>;
}
