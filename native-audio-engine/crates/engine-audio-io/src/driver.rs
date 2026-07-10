use engine_core::ProcessContext;
use engine_protocol::AudioTelemetry;

use crate::{
    ActiveOutputStream, AudioDeviceInfo, AudioDriverError, AudioDriverEvent, OutputStreamRequest,
};

pub trait AudioProcessor: Send + 'static {
    fn process(&mut self, output: &mut [f32], context: ProcessContext) -> AudioTelemetry;
}

pub trait AudioDriver {
    fn available_output_devices(&self) -> Result<Vec<AudioDeviceInfo>, AudioDriverError>;

    fn start_output(
        &mut self,
        request: OutputStreamRequest,
        processor: Box<dyn AudioProcessor>,
    ) -> Result<ActiveOutputStream, AudioDriverError>;

    fn stop(&mut self) -> Result<(), AudioDriverError>;

    fn drain_events(&mut self) -> Vec<AudioDriverEvent> {
        Vec::new()
    }
}
