use std::{
    env,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use engine_audio_io::{
    AudioDriver, AudioDriverEvent, CpalAudioDriver, EngineProcessor, NullAudioDriver,
    OutputStreamRequest,
};
use engine_core::{
    engine_command_queue, engine_telemetry_queue, AudioEngine, PARAM_DIAGNOSTIC_FREQUENCY,
    PARAM_DIAGNOSTIC_GAIN,
};
use engine_protocol::{diagnostic_tone_plan, EngineCommand, EngineEvent};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DriverKind {
    Cpal,
    Null,
}

#[derive(Clone, Debug)]
struct HostOptions {
    list_devices: bool,
    driver: DriverKind,
    device_id: Option<String>,
    sample_rate: Option<u32>,
    buffer_frames: Option<u32>,
    channels: Option<u16>,
    duration_ms: Option<u64>,
    diagnostic_tone: bool,
    frequency_hz: f32,
    gain: f32,
}

impl Default for HostOptions {
    fn default() -> Self {
        Self {
            list_devices: false,
            driver: DriverKind::Null,
            device_id: None,
            sample_rate: Some(48_000),
            buffer_frames: Some(128),
            channels: Some(2),
            duration_ms: None,
            diagnostic_tone: false,
            frequency_hz: 440.0,
            gain: 0.05,
        }
    }
}

fn main() {
    let options = parse_options(env::args().skip(1).collect()).unwrap_or_else(|message| {
        eprintln!("{message}");
        print_usage();
        std::process::exit(2);
    });

    if let Err(error) = run(options) {
        eprintln!("engine-host error: {:?}: {}", error.code, error.message);
        std::process::exit(1);
    }
}

fn run(options: HostOptions) -> Result<(), engine_audio_io::AudioDriverError> {
    let mut driver = build_driver(options.driver);

    if options.list_devices {
        let devices = driver.available_output_devices()?;

        println!("available output devices: {}", devices.len());
        for device in devices {
            let default_marker = if device.is_default { " default" } else { "" };

            println!("{}{}: {}", device.id, default_marker, device.name);
        }

        return Ok(());
    }

    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_requested_for_handler = stop_requested.clone();

    ctrlc::set_handler(move || {
        stop_requested_for_handler.store(true, Ordering::SeqCst);
    })
    .expect("failed to install Ctrl+C handler");

    let (command_sender, command_receiver) = engine_command_queue();
    let (telemetry_sender, telemetry_receiver) = engine_telemetry_queue();
    let mut engine = AudioEngine::new();

    let request = OutputStreamRequest {
        device_id: options.device_id,
        preferred_sample_rate: options.sample_rate,
        preferred_buffer_frames: options.buffer_frames,
        preferred_channels: options.channels,
    };

    println!(
        "requested: {} Hz, {} frames, {} channels",
        format_optional(request.preferred_sample_rate),
        format_optional(request.preferred_buffer_frames),
        format_optional(request.preferred_channels)
    );

    if options.diagnostic_tone {
        let maximum_frames = request
            .preferred_buffer_frames
            .map(|frames| frames.max(4096) as usize)
            .unwrap_or(4096);
        let plan = diagnostic_tone_plan(
            options.frequency_hz,
            0.0,
            request.preferred_channels.unwrap_or(2),
        );

        engine = engine
            .with_execution_plan(&plan, maximum_frames)
            .expect("failed to prepare diagnostic tone execution plan");
    }

    let engine = engine.with_realtime_queues(command_receiver, telemetry_sender);

    let active_stream = driver.start_output(request, Box::new(EngineProcessor::new(engine)))?;

    println!(
        "negotiated: {} [{}], {} Hz, requested buffer frames {:?}, {} channels, {:?}",
        active_stream.device_name,
        active_stream.device_id,
        active_stream.sample_rate,
        active_stream.requested_buffer_frames,
        active_stream.channels,
        active_stream.sample_format
    );

    let mut next_command_id = 1;

    if options.diagnostic_tone {
        let _ = command_sender.push(EngineCommand::SetParameter {
            id: next_command_id,
            parameter_id: PARAM_DIAGNOSTIC_FREQUENCY,
            value: options.frequency_hz,
            at_sample: 0,
            ramp_samples: 0,
        });
        next_command_id += 1;
        let _ = command_sender.push(EngineCommand::SetParameter {
            id: next_command_id,
            parameter_id: PARAM_DIAGNOSTIC_GAIN,
            value: 0.0,
            at_sample: 0,
            ramp_samples: 0,
        });
        next_command_id += 1;
    }

    let _ = command_sender.push(EngineCommand::TransportStart {
        id: next_command_id,
        at_sample: 0,
    });
    next_command_id += 1;

    if options.diagnostic_tone {
        let ramp_samples = options
            .sample_rate
            .map(|sample_rate| (sample_rate / 100).max(1))
            .unwrap_or(480);
        let _ = command_sender.push(EngineCommand::SetParameter {
            id: next_command_id,
            parameter_id: PARAM_DIAGNOSTIC_GAIN,
            value: options.gain,
            at_sample: 0,
            ramp_samples,
        });
        next_command_id += 1;
    }

    let started_at = std::time::Instant::now();

    while !stop_requested.load(Ordering::SeqCst) {
        for event in driver.drain_events() {
            print_driver_event(event);
        }

        while let Some(event) = telemetry_receiver.pop() {
            print_engine_event(event);
        }

        if options
            .duration_ms
            .map(|duration_ms| started_at.elapsed() >= Duration::from_millis(duration_ms))
            .unwrap_or(false)
        {
            break;
        }

        thread::sleep(Duration::from_millis(100));
    }

    let _ = command_sender.push(EngineCommand::TransportStop {
        id: next_command_id,
        at_sample: u64::MAX,
    });

    driver.stop()?;
    for event in driver.drain_events() {
        print_driver_event(event);
    }
    while let Some(event) = telemetry_receiver.pop() {
        print_engine_event(event);
    }

    Ok(())
}

fn build_driver(driver: DriverKind) -> Box<dyn AudioDriver> {
    match driver {
        DriverKind::Cpal => Box::new(CpalAudioDriver::new()),
        DriverKind::Null => Box::new(NullAudioDriver::new()),
    }
}

fn parse_options(args: Vec<String>) -> Result<HostOptions, String> {
    let mut options = HostOptions::default();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--list-devices" => options.list_devices = true,
            "--driver" => {
                index += 1;
                options.driver = match value(&args, index, "--driver")?.as_str() {
                    "cpal" => DriverKind::Cpal,
                    "null" => DriverKind::Null,
                    other => return Err(format!("unsupported driver: {other}")),
                };
            }
            "--device" => {
                index += 1;
                let device = value(&args, index, "--device")?;

                options.device_id = if device == "default" {
                    Some("default".to_string())
                } else {
                    Some(device)
                };
            }
            "--sample-rate" => {
                index += 1;
                options.sample_rate = Some(parse_number(&value(&args, index, "--sample-rate")?)?);
            }
            "--buffer-frames" => {
                index += 1;
                options.buffer_frames =
                    Some(parse_number(&value(&args, index, "--buffer-frames")?)?);
            }
            "--channels" => {
                index += 1;
                options.channels = Some(parse_number(&value(&args, index, "--channels")?)?);
            }
            "--duration-ms" => {
                index += 1;
                options.duration_ms = Some(parse_number(&value(&args, index, "--duration-ms")?)?);
            }
            "--diagnostic-tone" => options.diagnostic_tone = true,
            "--frequency" => {
                index += 1;
                options.frequency_hz = parse_number(&value(&args, index, "--frequency")?)?;
            }
            "--gain" => {
                index += 1;
                options.gain = parse_number(&value(&args, index, "--gain")?)?;
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => return Err(format!("unknown option: {other}")),
        }

        index += 1;
    }

    Ok(options)
}

fn value(args: &[String], index: usize, option: &str) -> Result<String, String> {
    args.get(index)
        .cloned()
        .ok_or_else(|| format!("missing value for {option}"))
}

fn parse_number<T>(value: &str) -> Result<T, String>
where
    T: std::str::FromStr,
{
    value
        .parse()
        .map_err(|_| format!("invalid numeric value: {value}"))
}

fn format_optional<T>(value: Option<T>) -> String
where
    T: std::fmt::Display,
{
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "default".to_string())
}

fn print_usage() {
    eprintln!(
        "usage:
  engine-host --list-devices --driver cpal
  engine-host --driver cpal --device default --sample-rate 48000 --channels 2
  engine-host --driver null --sample-rate 48000 --buffer-frames 128 --channels 2

optional:
  --duration-ms 1000
  --diagnostic-tone --frequency 440 --gain 0.05"
    );
}

fn print_driver_event(event: AudioDriverEvent) {
    match event {
        AudioDriverEvent::StreamError { code } => {
            println!("driver event: stream error {code:?}");
        }
        AudioDriverEvent::StreamStarted {
            sample_rate,
            channels,
        } => {
            println!("driver event: stream started {sample_rate} Hz, {channels} channels");
        }
        AudioDriverEvent::StreamStopped => {
            println!("driver event: stream stopped");
        }
    }
}

fn print_engine_event(event: EngineEvent) {
    match event {
        EngineEvent::CommandApplied {
            command_id,
            applied_sample,
            late_by_samples,
        } => {
            println!(
                "engine event: command {command_id} applied at sample {applied_sample}, late by {late_by_samples}"
            );
        }
        EngineEvent::CommandRejected { command_id, reason } => {
            println!("engine event: command {command_id} rejected: {reason:?}");
        }
        EngineEvent::TransportStateChanged { playing, at_sample } => {
            println!("engine event: transport playing={playing} at sample {at_sample}");
        }
        EngineEvent::StreamError { code } => {
            println!("engine event: stream error code {code}");
        }
        EngineEvent::Telemetry(telemetry) => {
            println!(
                "engine telemetry: sample {}, callbacks {}",
                telemetry.sample_position, telemetry.callback_count
            );
        }
        EngineEvent::LifecycleStarted => {
            println!("engine event: lifecycle started");
        }
        EngineEvent::LifecycleStopped => {
            println!("engine event: lifecycle stopped");
        }
    }
}
