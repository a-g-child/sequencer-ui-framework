use engine_core::{AudioEngine, ProcessContext};
use engine_protocol::AudioTelemetry;

use crate::{
    ActiveStreamInfo, AudioDeviceInfo, AudioDriver, AudioIoError, AudioProcessor, StreamRequest,
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
    fn process_interleaved(
        &mut self,
        output: &mut [f32],
        frame_count: usize,
        channels: usize,
        sample_rate: f64,
    ) -> AudioTelemetry {
        self.engine.process(
            output,
            ProcessContext {
                block_start_sample: self.engine.sample_position(),
                frame_count: frame_count as u32,
                sample_rate,
                output_channels: channels as u16,
            },
        )
    }
}

pub struct NullAudioDriver {
    active: bool,
    processor: Option<Box<dyn AudioProcessor>>,
    stream: Option<ActiveStreamInfo>,
    last_telemetry: Option<engine_protocol::AudioTelemetry>,
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
            last_telemetry: None,
        }
    }

    pub fn process_blocks(&mut self, block_count: usize) -> Result<(), AudioIoError> {
        for _ in 0..block_count {
            self.process_next_block()?;
        }

        Ok(())
    }

    pub fn process_until_sample(&mut self, sample_position: u64) -> Result<(), AudioIoError> {
        while self
            .last_telemetry
            .map(|telemetry| telemetry.sample_position)
            .unwrap_or(0)
            < sample_position
        {
            self.process_next_block()?;
        }

        Ok(())
    }

    pub fn last_telemetry(&self) -> Option<engine_protocol::AudioTelemetry> {
        self.last_telemetry
    }

    fn process_next_block(&mut self) -> Result<(), AudioIoError> {
        if !self.active {
            return Err(AudioIoError {
                message: "null driver stream is not active".to_string(),
            });
        }

        let stream = self.stream.ok_or_else(|| AudioIoError {
            message: "null driver stream is missing configuration".to_string(),
        })?;
        let processor = self.processor.as_mut().ok_or_else(|| AudioIoError {
            message: "null driver stream is missing processor".to_string(),
        })?;
        let channels = stream.output_channels.max(1) as usize;
        let frames = stream.buffer_frames.max(1) as usize;
        let mut output = vec![0.0; frames * channels];
        let telemetry = processor.process_interleaved(
            &mut output,
            frames,
            channels,
            stream.sample_rate.max(1) as f64,
        );

        self.last_telemetry = Some(telemetry);
        Ok(())
    }
}

impl AudioDriver for NullAudioDriver {
    fn enumerate_devices(&self) -> Result<Vec<AudioDeviceInfo>, AudioIoError> {
        Ok(vec![AudioDeviceInfo {
            id: "null".to_string(),
            name: "Null Output".to_string(),
        }])
    }

    fn start(
        &mut self,
        requested: StreamRequest,
        processor: Box<dyn AudioProcessor>,
    ) -> Result<ActiveStreamInfo, AudioIoError> {
        self.active = true;
        self.stream = Some(ActiveStreamInfo {
            sample_rate: requested.preferred_sample_rate,
            buffer_frames: requested.preferred_buffer_frames,
            output_channels: requested.output_channels,
        });
        self.processor = Some(processor);
        self.process_next_block()?;

        Ok(self
            .stream
            .expect("null driver stream should be configured"))
    }

    fn stop(&mut self) -> Result<(), AudioIoError> {
        self.active = false;
        self.processor = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_core::AudioEngine;

    #[test]
    fn processes_multiple_deterministic_blocks() {
        let mut driver = NullAudioDriver::new();

        driver
            .start(
                StreamRequest {
                    preferred_sample_rate: 48_000,
                    preferred_buffer_frames: 128,
                    output_channels: 2,
                },
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
            .start(
                StreamRequest {
                    preferred_sample_rate: 48_000,
                    preferred_buffer_frames: 128,
                    output_channels: 2,
                },
                Box::new(EngineProcessor::new(AudioEngine::new())),
            )
            .unwrap();
        driver.process_until_sample(48_000).unwrap();

        assert!(driver.last_telemetry().unwrap().sample_position >= 48_000);
    }
}
