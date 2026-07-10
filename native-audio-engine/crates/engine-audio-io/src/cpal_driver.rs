use std::sync::mpsc::{self, Receiver, Sender};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    BufferSize, Device, SampleFormat, SampleRate, Stream, StreamConfig, SupportedStreamConfig,
};
use engine_core::ProcessContext;

use crate::{
    ActiveOutputStream, AudioDeviceInfo, AudioDriver, AudioDriverError, AudioDriverErrorCode,
    AudioDriverEvent, AudioProcessor, AudioSampleFormat, OutputStreamRequest,
};

const DEFAULT_SCRATCH_FRAMES: usize = 4096;

pub struct CpalAudioDriver {
    host: cpal::Host,
    stream: Option<Stream>,
    events: Vec<AudioDriverEvent>,
    event_sender: Sender<AudioDriverEvent>,
    event_receiver: Receiver<AudioDriverEvent>,
}

impl Default for CpalAudioDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl CpalAudioDriver {
    pub fn new() -> Self {
        let (event_sender, event_receiver) = mpsc::channel();

        Self {
            host: cpal::default_host(),
            stream: None,
            events: Vec::new(),
            event_sender,
            event_receiver,
        }
    }

    fn output_devices(&self) -> Result<Vec<Device>, AudioDriverError> {
        self.host
            .output_devices()
            .map(|devices| devices.collect())
            .map_err(|error| {
                AudioDriverError::new(
                    AudioDriverErrorCode::DeviceUnavailable,
                    format!("failed to enumerate CPAL output devices: {error}"),
                )
            })
    }

    fn default_output_device_name(&self) -> Option<String> {
        self.host
            .default_output_device()
            .and_then(|device| device.name().ok())
    }

    fn select_device(&self, device_id: Option<&str>) -> Result<(String, Device), AudioDriverError> {
        if device_id.is_none() || device_id == Some("default") {
            let device = self.host.default_output_device().ok_or_else(|| {
                AudioDriverError::new(
                    AudioDriverErrorCode::DeviceUnavailable,
                    "no default CPAL output device is available",
                )
            })?;

            return Ok(("default".to_string(), device));
        }

        let requested = device_id.expect("device id should be present");
        let devices = self.output_devices()?;

        for (index, device) in devices.into_iter().enumerate() {
            let generated_id = format!("cpal:{index}");
            let name = device.name().unwrap_or_else(|_| generated_id.clone());

            if requested == generated_id || requested == name {
                return Ok((generated_id, device));
            }
        }

        Err(AudioDriverError::new(
            AudioDriverErrorCode::DeviceUnavailable,
            format!("CPAL output device not found: {requested}"),
        ))
    }

    fn select_config(
        &self,
        device: &Device,
        request: &OutputStreamRequest,
    ) -> Result<SupportedStreamConfig, AudioDriverError> {
        let mut ranges: Vec<_> = device
            .supported_output_configs()
            .map_err(|error| {
                AudioDriverError::new(
                    AudioDriverErrorCode::DeviceUnavailable,
                    format!("failed to query CPAL output configs: {error}"),
                )
            })?
            .collect();

        ranges.sort_by_key(|range| sample_format_preference(range.sample_format()));

        let requested_channels = request.preferred_channels;

        for range in ranges {
            if let Some(channels) = requested_channels {
                if range.channels() != channels {
                    continue;
                }
            }

            if !is_supported_sample_format(range.sample_format()) {
                continue;
            }

            if let Some(sample_rate) = request.preferred_sample_rate {
                let sample_rate = SampleRate(sample_rate);

                if sample_rate >= range.min_sample_rate() && sample_rate <= range.max_sample_rate()
                {
                    return Ok(range.with_sample_rate(sample_rate));
                }
            } else {
                return Ok(range.with_max_sample_rate());
            }
        }

        Err(AudioDriverError::new(
            AudioDriverErrorCode::UnsupportedSampleFormat,
            "no supported CPAL output config matched the request",
        ))
    }
}

impl AudioDriver for CpalAudioDriver {
    fn available_output_devices(&self) -> Result<Vec<AudioDeviceInfo>, AudioDriverError> {
        let default_name = self.default_output_device_name();

        self.output_devices().map(|devices| {
            devices
                .into_iter()
                .enumerate()
                .map(|(index, device)| {
                    let id = format!("cpal:{index}");
                    let name = device.name().unwrap_or_else(|_| id.clone());
                    let is_default = default_name.as_ref() == Some(&name);

                    AudioDeviceInfo {
                        id,
                        name,
                        is_default,
                    }
                })
                .collect()
        })
    }

    fn start_output(
        &mut self,
        request: OutputStreamRequest,
        processor: Box<dyn AudioProcessor>,
    ) -> Result<ActiveOutputStream, AudioDriverError> {
        if self.stream.is_some() {
            self.stop()?;
        }

        let (device_id, device) = self.select_device(request.device_id.as_deref())?;
        let device_name = device.name().unwrap_or_else(|_| device_id.clone());
        let supported_config = self.select_config(&device, &request)?;
        let sample_format = supported_config.sample_format();
        let sample_rate = supported_config.sample_rate().0;
        let channels = supported_config.channels();
        let config = StreamConfig {
            channels,
            sample_rate: supported_config.sample_rate(),
            buffer_size: request
                .preferred_buffer_frames
                .map(BufferSize::Fixed)
                .unwrap_or(BufferSize::Default),
        };
        let event_sender = self.event_sender.clone();
        let stream = match sample_format {
            SampleFormat::F32 => {
                build_f32_stream(&device, &config, processor, event_sender.clone())?
            }
            SampleFormat::I16 => build_i16_stream(
                &device,
                &config,
                processor,
                event_sender.clone(),
                request.preferred_buffer_frames,
            )?,
            SampleFormat::U16 => build_u16_stream(
                &device,
                &config,
                processor,
                event_sender.clone(),
                request.preferred_buffer_frames,
            )?,
            _ => {
                return Err(AudioDriverError::new(
                    AudioDriverErrorCode::UnsupportedSampleFormat,
                    format!("unsupported CPAL sample format: {sample_format:?}"),
                ));
            }
        };

        stream.play().map_err(|error| {
            AudioDriverError::new(
                AudioDriverErrorCode::PlayStream,
                format!("failed to start CPAL output stream: {error}"),
            )
        })?;

        self.stream = Some(stream);
        self.events.push(AudioDriverEvent::StreamStarted {
            sample_rate,
            channels,
        });

        Ok(ActiveOutputStream {
            device_id,
            device_name,
            sample_rate,
            channels,
            sample_format: sample_format.into(),
            requested_buffer_frames: request.preferred_buffer_frames,
        })
    }

    fn stop(&mut self) -> Result<(), AudioDriverError> {
        if self.stream.take().is_some() {
            self.events.push(AudioDriverEvent::StreamStopped);
        }

        Ok(())
    }

    fn drain_events(&mut self) -> Vec<AudioDriverEvent> {
        while let Ok(event) = self.event_receiver.try_recv() {
            self.events.push(event);
        }

        std::mem::take(&mut self.events)
    }
}

fn build_f32_stream(
    device: &Device,
    config: &StreamConfig,
    mut processor: Box<dyn AudioProcessor>,
    event_sender: Sender<AudioDriverEvent>,
) -> Result<Stream, AudioDriverError> {
    let sample_rate = config.sample_rate.0;
    let channels = config.channels as usize;
    let mut sample_position = 0_u64;
    let error_sender = event_sender.clone();

    device
        .build_output_stream(
            config,
            move |output: &mut [f32], _| {
                let frame_count = frame_count(output.len(), channels);
                let block_start_sample = sample_position;

                processor.process(
                    output,
                    ProcessContext {
                        block_start_sample,
                        frame_count,
                        sample_rate: sample_rate as f64,
                        output_channels: channels as u16,
                    },
                );
                sample_position = sample_position.saturating_add(frame_count as u64);
            },
            move |_| {
                let _ = error_sender.send(AudioDriverEvent::StreamError {
                    code: AudioDriverErrorCode::StreamRuntime,
                });
            },
            None,
        )
        .map_err(|error| {
            AudioDriverError::new(
                AudioDriverErrorCode::BuildStream,
                format!("failed to build f32 CPAL stream: {error}"),
            )
        })
}

fn build_i16_stream(
    device: &Device,
    config: &StreamConfig,
    mut processor: Box<dyn AudioProcessor>,
    event_sender: Sender<AudioDriverEvent>,
    preferred_buffer_frames: Option<u32>,
) -> Result<Stream, AudioDriverError> {
    let sample_rate = config.sample_rate.0;
    let channels = config.channels as usize;
    let mut sample_position = 0_u64;
    let mut scratch = vec![0.0_f32; scratch_len(channels, preferred_buffer_frames)];
    let error_sender = event_sender.clone();

    device
        .build_output_stream(
            config,
            move |output: &mut [i16], _| {
                let frame_count = frame_count(output.len(), channels);
                let required_len = output.len();

                if required_len > scratch.len() {
                    output.fill(0);
                    return;
                }

                let block_start_sample = sample_position;
                let scratch = &mut scratch[..required_len];

                processor.process(
                    scratch,
                    ProcessContext {
                        block_start_sample,
                        frame_count,
                        sample_rate: sample_rate as f64,
                        output_channels: channels as u16,
                    },
                );

                for (target, sample) in output.iter_mut().zip(scratch.iter()) {
                    *target = f32_to_i16(*sample);
                }

                sample_position = sample_position.saturating_add(frame_count as u64);
            },
            move |_| {
                let _ = error_sender.send(AudioDriverEvent::StreamError {
                    code: AudioDriverErrorCode::StreamRuntime,
                });
            },
            None,
        )
        .map_err(|error| {
            AudioDriverError::new(
                AudioDriverErrorCode::BuildStream,
                format!("failed to build i16 CPAL stream: {error}"),
            )
        })
}

fn build_u16_stream(
    device: &Device,
    config: &StreamConfig,
    mut processor: Box<dyn AudioProcessor>,
    event_sender: Sender<AudioDriverEvent>,
    preferred_buffer_frames: Option<u32>,
) -> Result<Stream, AudioDriverError> {
    let sample_rate = config.sample_rate.0;
    let channels = config.channels as usize;
    let mut sample_position = 0_u64;
    let mut scratch = vec![0.0_f32; scratch_len(channels, preferred_buffer_frames)];
    let error_sender = event_sender.clone();

    device
        .build_output_stream(
            config,
            move |output: &mut [u16], _| {
                let frame_count = frame_count(output.len(), channels);
                let required_len = output.len();

                if required_len > scratch.len() {
                    output.fill(u16::MAX / 2);
                    return;
                }

                let block_start_sample = sample_position;
                let scratch = &mut scratch[..required_len];

                processor.process(
                    scratch,
                    ProcessContext {
                        block_start_sample,
                        frame_count,
                        sample_rate: sample_rate as f64,
                        output_channels: channels as u16,
                    },
                );

                for (target, sample) in output.iter_mut().zip(scratch.iter()) {
                    *target = f32_to_u16(*sample);
                }

                sample_position = sample_position.saturating_add(frame_count as u64);
            },
            move |_| {
                let _ = error_sender.send(AudioDriverEvent::StreamError {
                    code: AudioDriverErrorCode::StreamRuntime,
                });
            },
            None,
        )
        .map_err(|error| {
            AudioDriverError::new(
                AudioDriverErrorCode::BuildStream,
                format!("failed to build u16 CPAL stream: {error}"),
            )
        })
}

fn frame_count(sample_count: usize, channels: usize) -> u32 {
    if channels == 0 {
        return 0;
    }

    (sample_count / channels) as u32
}

fn scratch_len(channels: usize, preferred_buffer_frames: Option<u32>) -> usize {
    let frames = preferred_buffer_frames
        .map(|frames| frames.max(DEFAULT_SCRATCH_FRAMES as u32) as usize)
        .unwrap_or(DEFAULT_SCRATCH_FRAMES);

    frames * channels.max(1)
}

fn is_supported_sample_format(sample_format: SampleFormat) -> bool {
    matches!(
        sample_format,
        SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16
    )
}

fn sample_format_preference(sample_format: SampleFormat) -> u8 {
    match sample_format {
        SampleFormat::F32 => 0,
        SampleFormat::I16 => 1,
        SampleFormat::U16 => 2,
        _ => 3,
    }
}

fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

fn f32_to_u16(sample: f32) -> u16 {
    ((sample.clamp(-1.0, 1.0) + 1.0) * 0.5 * u16::MAX as f32).round() as u16
}

impl From<SampleFormat> for AudioSampleFormat {
    fn from(sample_format: SampleFormat) -> Self {
        match sample_format {
            SampleFormat::F32 => Self::F32,
            SampleFormat::I16 => Self::I16,
            SampleFormat::U16 => Self::U16,
            _ => Self::F32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_f32_to_signed_integer_samples() {
        assert_eq!(f32_to_i16(-2.0), i16::MIN + 1);
        assert_eq!(f32_to_i16(0.0), 0);
        assert_eq!(f32_to_i16(2.0), i16::MAX);
    }

    #[test]
    fn converts_f32_to_unsigned_integer_samples() {
        assert_eq!(f32_to_u16(-2.0), 0);
        assert_eq!(f32_to_u16(0.0), 32768);
        assert_eq!(f32_to_u16(2.0), u16::MAX);
    }
}
