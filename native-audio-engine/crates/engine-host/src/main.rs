use engine_audio_io::{AudioDriver, EngineProcessor, NullAudioDriver, StreamRequest};
use engine_core::AudioEngine;

fn main() {
    let mut driver = NullAudioDriver::new();
    let devices = driver
        .enumerate_devices()
        .expect("failed to enumerate audio devices");

    println!("available audio devices: {}", devices.len());

    let stream = driver
        .start(
            StreamRequest {
                preferred_sample_rate: 48_000,
                preferred_buffer_frames: 128,
                output_channels: 2,
            },
            Box::new(EngineProcessor::new(AudioEngine::new())),
        )
        .expect("failed to start audio stream");

    println!(
        "started stream: {} Hz, {} frames, {} channels",
        stream.sample_rate, stream.buffer_frames, stream.output_channels
    );

    driver.stop().expect("failed to stop audio stream");
}
