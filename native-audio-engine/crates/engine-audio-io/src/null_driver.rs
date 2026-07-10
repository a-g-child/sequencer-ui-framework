use engine_core::{AudioEngine, ProcessContext};
use engine_protocol::AudioTelemetry;

use crate::{
    ActiveOutputStream, AudioDeviceInfo, AudioDriver, AudioDriverError, AudioDriverErrorCode,
    AudioDriverEvent, AudioProcessor, AudioSampleFormat, OutputStreamRequest,
};

pub struct EngineProcessor {
    engine: AudioEngine,
}

impl EngineProcessor {
    pub fn new(engine: AudioEngine) -> Self {
        Self { engine }
    }
}

impl AudioProcessor for EngineProcessor {
    fn process(&mut self, output: &mut [f32], context: ProcessContext) -> AudioTelemetry {
        self.engine.process(output, context)
    }
}

pub struct NullAudioDriver {
    active: bool,
    processor: Option<Box<dyn AudioProcessor>>,
    stream: Option<ActiveOutputStream>,
    buffer_frames: u32,
    last_telemetry: Option<engine_protocol::AudioTelemetry>,
    events: Vec<AudioDriverEvent>,
}

impl Default for NullAudioDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl NullAudioDriver {
    pub fn new() -> Self {
        Self {
            active: false,
            processor: None,
            stream: None,
            buffer_frames: 128,
            last_telemetry: None,
            events: Vec::new(),
        }
    }

    pub fn process_blocks(&mut self, block_count: usize) -> Result<(), AudioDriverError> {
        for _ in 0..block_count {
            self.process_next_block_with_frames(self.buffer_frames)
                .map(drop)?;
        }

        Ok(())
    }

    pub fn render_blocks(&mut self, block_count: usize) -> Result<Vec<f32>, AudioDriverError> {
        let mut rendered = Vec::new();

        for _ in 0..block_count {
            rendered.extend(self.process_next_block_with_frames(self.buffer_frames)?);
        }

        Ok(rendered)
    }

    pub fn render_frames(&mut self, frame_count: u32) -> Result<Vec<f32>, AudioDriverError> {
        self.process_next_block_with_frames(frame_count)
    }

    pub fn process_until_sample(&mut self, sample_position: u64) -> Result<(), AudioDriverError> {
        while self
            .last_telemetry
            .map(|telemetry| telemetry.sample_position)
            .unwrap_or(0)
            < sample_position
        {
            self.process_next_block_with_frames(self.buffer_frames)
                .map(drop)?;
        }

        Ok(())
    }

    pub fn last_telemetry(&self) -> Option<engine_protocol::AudioTelemetry> {
        self.last_telemetry
    }

    pub fn process_block_with_frames(&mut self, frame_count: u32) -> Result<(), AudioDriverError> {
        self.process_next_block_with_frames(frame_count).map(drop)
    }

    fn process_next_block_with_frames(
        &mut self,
        frame_count: u32,
    ) -> Result<Vec<f32>, AudioDriverError> {
        if !self.active {
            return Err(AudioDriverError::new(
                AudioDriverErrorCode::DeviceUnavailable,
                "null driver stream is not active",
            ));
        }

        let stream = self.stream.as_ref().ok_or_else(|| {
            AudioDriverError::new(
                AudioDriverErrorCode::DeviceUnavailable,
                "null driver stream is missing configuration",
            )
        })?;
        let processor = self.processor.as_mut().ok_or_else(|| {
            AudioDriverError::new(
                AudioDriverErrorCode::DeviceUnavailable,
                "null driver stream is missing processor",
            )
        })?;
        let channels = stream.channels.max(1) as usize;
        let frames = frame_count.max(1) as usize;
        let mut output = vec![0.0; frames * channels];
        let block_start_sample = self
            .last_telemetry
            .map(|telemetry| telemetry.sample_position)
            .unwrap_or(0);
        let telemetry = processor.process(
            &mut output,
            ProcessContext {
                block_start_sample,
                frame_count: frames as u32,
                sample_rate: stream.sample_rate.max(1) as f64,
                output_channels: stream.channels,
            },
        );

        self.last_telemetry = Some(telemetry);
        Ok(output)
    }
}

impl AudioDriver for NullAudioDriver {
    fn available_output_devices(&self) -> Result<Vec<AudioDeviceInfo>, AudioDriverError> {
        Ok(vec![AudioDeviceInfo {
            id: "null".to_string(),
            name: "Null Output".to_string(),
            is_default: true,
        }])
    }

    fn start_output(
        &mut self,
        requested: OutputStreamRequest,
        processor: Box<dyn AudioProcessor>,
    ) -> Result<ActiveOutputStream, AudioDriverError> {
        self.active = true;
        self.buffer_frames = requested.preferred_buffer_frames.unwrap_or(128);
        self.stream = Some(ActiveOutputStream {
            device_id: requested
                .device_id
                .filter(|device_id| device_id != "default")
                .unwrap_or_else(|| "null".to_string()),
            device_name: "Null Output".to_string(),
            sample_rate: requested.preferred_sample_rate.unwrap_or(48_000),
            channels: requested.preferred_channels.unwrap_or(2),
            sample_format: AudioSampleFormat::F32,
            requested_buffer_frames: requested.preferred_buffer_frames,
        });
        self.processor = Some(processor);
        self.events.push(AudioDriverEvent::StreamStarted {
            sample_rate: self
                .stream
                .as_ref()
                .expect("null driver stream should be configured")
                .sample_rate,
            channels: self
                .stream
                .as_ref()
                .expect("null driver stream should be configured")
                .channels,
        });
        self.process_next_block_with_frames(self.buffer_frames)
            .map(drop)?;

        Ok(self
            .stream
            .clone()
            .expect("null driver stream should be configured"))
    }

    fn stop(&mut self) -> Result<(), AudioDriverError> {
        self.active = false;
        self.processor = None;
        self.events.push(AudioDriverEvent::StreamStopped);
        Ok(())
    }

    fn drain_events(&mut self) -> Vec<AudioDriverEvent> {
        std::mem::take(&mut self.events)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_core::{engine_command_queue, engine_telemetry_queue, AudioEngine};
    use engine_protocol::{EngineCommand, EngineEvent};

    fn request(buffer_frames: u32) -> OutputStreamRequest {
        OutputStreamRequest {
            device_id: None,
            preferred_sample_rate: Some(48_000),
            preferred_buffer_frames: Some(buffer_frames),
            preferred_channels: Some(2),
        }
    }

    #[test]
    fn processes_multiple_deterministic_blocks() {
        let mut driver = NullAudioDriver::new();

        driver
            .start_output(
                request(128),
                Box::new(EngineProcessor::new(AudioEngine::new())),
            )
            .unwrap();
        driver.process_blocks(3).unwrap();

        assert_eq!(driver.last_telemetry().unwrap().sample_position, 512);
    }

    #[test]
    fn processes_until_sample_position() {
        let mut driver = NullAudioDriver::new();

        driver
            .start_output(
                request(128),
                Box::new(EngineProcessor::new(AudioEngine::new())),
            )
            .unwrap();
        driver.process_until_sample(48_000).unwrap();

        assert!(driver.last_telemetry().unwrap().sample_position >= 48_000);
    }

    #[test]
    fn handles_variable_callback_lengths() {
        let (command_sender, command_receiver) = engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = engine_telemetry_queue();
        let engine = AudioEngine::new().with_realtime_queues(command_receiver, telemetry_sender);
        let mut driver = NullAudioDriver::new();

        command_sender
            .push(EngineCommand::SetParameter {
                id: 1,
                parameter_id: 2,
                value: 0.25,
                at_sample: 300,
                ramp_samples: 0,
            })
            .unwrap();

        driver
            .start_output(request(128), Box::new(EngineProcessor::new(engine)))
            .unwrap();
        driver.process_block_with_frames(128).unwrap();
        driver.process_block_with_frames(256).unwrap();
        driver.process_block_with_frames(64).unwrap();

        assert_eq!(driver.last_telemetry().unwrap().sample_position, 576);
        assert_eq!(
            telemetry_receiver.pop(),
            Some(EngineEvent::CommandApplied {
                command_id: 1,
                applied_sample: 300,
                late_by_samples: 0
            })
        );
    }

    #[test]
    fn supports_repeated_start_stop_cycles() {
        let mut driver = NullAudioDriver::new();

        for _ in 0..2 {
            driver
                .start_output(
                    request(128),
                    Box::new(EngineProcessor::new(AudioEngine::new())),
                )
                .unwrap();
            assert!(driver.last_telemetry().is_some());
            driver.stop().unwrap();
        }
    }

    #[test]
    fn renders_deterministic_audio_buffers() {
        let (command_sender, command_receiver) = engine_command_queue();
        let (telemetry_sender, _telemetry_receiver) = engine_telemetry_queue();
        let engine = AudioEngine::new()
            .with_diagnostic_signal()
            .with_realtime_queues(command_receiver, telemetry_sender);
        let mut driver = NullAudioDriver::new();

        command_sender
            .push(EngineCommand::TransportStart {
                id: 10,
                at_sample: 128,
            })
            .unwrap();

        driver
            .start_output(request(128), Box::new(EngineProcessor::new(engine)))
            .unwrap();

        let rendered = driver.render_frames(128).unwrap();

        assert_eq!(rendered.len(), 256);
        assert!(rendered.iter().any(|sample| *sample != 0.0));
    }
}
