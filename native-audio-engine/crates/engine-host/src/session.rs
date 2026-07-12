use std::io::{BufRead, Write};

use engine_audio_io::{
    ActiveOutputStream, AudioDriver, AudioDriverError, AudioDriverEvent, CpalAudioDriver,
    EngineProcessor, NullAudioDriver, OutputStreamRequest,
};
use engine_core::{
    engine_command_queue, engine_telemetry_queue, prepared_plan_transfer_queue, retired_plan_queue,
    AudioEngine, EngineCommandSender, EngineTelemetryReceiver,
};
use engine_protocol::{AudioTelemetry, EngineCommand, EngineEvent};

use crate::DriverKind;

const SESSION_PROTOCOL_VERSION: u32 = 1;

pub fn run_stdio_session<R, W>(reader: R, writer: W) -> Result<(), SessionError>
where
    R: BufRead,
    W: Write,
{
    Session::new(writer).run(reader)
}

#[derive(Debug)]
pub struct SessionError {
    message: String,
}

impl SessionError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SessionError {}

impl From<std::io::Error> for SessionError {
    fn from(error: std::io::Error) -> Self {
        Self::new(error.to_string())
    }
}

struct Session<W: Write> {
    writer: W,
    driver: Option<SessionDriver>,
    stream: Option<ActiveOutputStream>,
    command_sender: Option<EngineCommandSender>,
    telemetry_receiver: Option<EngineTelemetryReceiver>,
    next_command_id: u64,
    last_telemetry: Option<AudioTelemetry>,
}

impl<W: Write> Session<W> {
    fn new(writer: W) -> Self {
        Self {
            writer,
            driver: None,
            stream: None,
            command_sender: None,
            telemetry_receiver: None,
            next_command_id: 1,
            last_telemetry: None,
        }
    }

    fn run<R: BufRead>(&mut self, reader: R) -> Result<(), SessionError> {
        self.write_ready()?;

        for line in reader.lines() {
            let line = line?;
            let line = line.trim();

            if line.is_empty() {
                continue;
            }

            let request = SessionRequest::parse(line);
            let shutdown = request.command == "session:shutdown";

            if let Err(error) = self.handle_request(request) {
                self.write_error(None, "session:error", "SessionError", &error.message)?;
            }

            self.writer.flush()?;

            if shutdown {
                break;
            }
        }

        Ok(())
    }

    fn handle_request(&mut self, request: SessionRequest) -> Result<(), SessionError> {
        match request.command.as_str() {
            "session:hello" => self.write_hello(&request),
            "session:capabilities" => self.write_capabilities(&request),
            "audio:list-devices" => self.list_devices(&request),
            "audio:start" => self.start_audio(&request),
            "audio:stop" => self.stop_audio(&request),
            "engine:snapshot" => self.write_snapshot(&request),
            "session:shutdown" => {
                if self.stream.is_some() {
                    self.stop_audio(&SessionRequest {
                        request_id: None,
                        command: "audio:stop".to_string(),
                        options: Vec::new(),
                    })?;
                }

                self.write_ok_prefix(&request, "session:shutdown")?;
                writeln!(self.writer, "}}")?;
                Ok(())
            }
            other => self.write_error(
                request.request_id,
                "error",
                "UnknownCommand",
                &format!("unknown command: {other}"),
            ),
        }
    }

    fn write_ready(&mut self) -> Result<(), SessionError> {
        writeln!(
            self.writer,
            "{{\"type\":\"session:ready\",\"protocolVersion\":{SESSION_PROTOCOL_VERSION}}}"
        )?;
        Ok(())
    }

    fn write_hello(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        self.write_ok_prefix(request, "session:hello")?;
        writeln!(
            self.writer,
            ",\"protocolVersion\":{SESSION_PROTOCOL_VERSION},\"host\":\"engine-host\"}}"
        )?;
        Ok(())
    }

    fn write_capabilities(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        self.write_ok_prefix(request, "session:capabilities")?;
        writeln!(
            self.writer,
            ",\"drivers\":[\"null\",\"cpal\"],\"messages\":[\"session:hello\",\"session:capabilities\",\"audio:list-devices\",\"audio:start\",\"audio:stop\",\"engine:snapshot\",\"session:shutdown\"]}}"
        )?;
        Ok(())
    }

    fn list_devices(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        let driver_kind = request.driver();
        let driver = build_session_driver(driver_kind);
        let devices = driver
            .available_output_devices()
            .map_err(session_driver_error)?;

        self.write_ok_prefix(request, "audio:devices")?;
        write!(
            self.writer,
            ",\"driver\":\"{}\",\"devices\":[",
            driver_kind.as_str()
        )?;

        for (index, device) in devices.iter().enumerate() {
            if index > 0 {
                write!(self.writer, ",")?;
            }

            write!(
                self.writer,
                "{{\"id\":\"{}\",\"name\":\"{}\",\"isDefault\":{}}}",
                escape_json(&device.id),
                escape_json(&device.name),
                device.is_default
            )?;
        }

        writeln!(self.writer, "]}}")?;
        Ok(())
    }

    fn start_audio(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        if self.stream.is_some() {
            self.write_error(
                request.request_id,
                "error",
                "AudioAlreadyRunning",
                "audio stream is already active",
            )?;
            return Ok(());
        }

        let driver_kind = request.driver();
        let mut driver = build_session_driver(driver_kind);
        let output_request = OutputStreamRequest {
            device_id: request.option("device").map(ToOwned::to_owned),
            preferred_sample_rate: request.parse_u32("sample_rate")?,
            preferred_buffer_frames: request.parse_u32("buffer_frames")?,
            preferred_channels: request.parse_u16("channels")?,
        };
        let (command_sender, command_receiver) = engine_command_queue();
        let (telemetry_sender, telemetry_receiver) = engine_telemetry_queue();
        let (_prepared_sender, prepared_receiver) = prepared_plan_transfer_queue();
        let (retired_sender, _retired_receiver) = retired_plan_queue();
        let engine = AudioEngine::new()
            .with_realtime_queues(command_receiver, telemetry_sender)
            .with_plan_transfer_queues(prepared_receiver, retired_sender);
        let stream = driver
            .start_output(output_request, Box::new(EngineProcessor::new(engine)))
            .map_err(session_driver_error)?;

        self.write_ok_prefix(request, "audio:started")?;
        writeln!(
            self.writer,
            ",\"driver\":\"{}\",\"deviceId\":\"{}\",\"deviceName\":\"{}\",\"sampleRate\":{},\"channels\":{},\"sampleFormat\":\"{:?}\",\"requestedBufferFrames\":{}}}",
            driver_kind.as_str(),
            escape_json(&stream.device_id),
            escape_json(&stream.device_name),
            stream.sample_rate,
            stream.channels,
            stream.sample_format,
            optional_u32_json(stream.requested_buffer_frames)
        )?;

        self.driver = Some(driver);
        self.stream = Some(stream);
        self.command_sender = Some(command_sender);
        self.telemetry_receiver = Some(telemetry_receiver);
        self.drain_runtime_events()?;
        Ok(())
    }

    fn stop_audio(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        if let Some(command_sender) = &self.command_sender {
            let _ = command_sender.push(EngineCommand::TransportStop {
                id: self.next_command_id,
                at_sample: u64::MAX,
            });
            self.next_command_id = self.next_command_id.saturating_add(1);
        }

        if let Some(driver) = &mut self.driver {
            driver.stop().map_err(session_driver_error)?;
        }

        self.drain_runtime_events()?;
        self.driver = None;
        self.stream = None;
        self.command_sender = None;
        self.telemetry_receiver = None;
        self.write_ok_prefix(request, "audio:stopped")?;
        writeln!(self.writer, "}}")?;
        Ok(())
    }

    fn write_snapshot(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        self.drain_runtime_events()?;

        self.write_ok_prefix(request, "engine:snapshot")?;

        if let Some(stream) = &self.stream {
            write!(
                self.writer,
                ",\"stream\":{{\"deviceId\":\"{}\",\"sampleRate\":{},\"channels\":{}}}",
                escape_json(&stream.device_id),
                stream.sample_rate,
                stream.channels
            )?;
        } else {
            write!(self.writer, ",\"stream\":null")?;
        }

        if let Some(telemetry) = self.last_telemetry {
            write!(
                self.writer,
                ",\"telemetry\":{{\"samplePosition\":{},\"callbackCount\":{},\"sampleRate\":{},\"callbackFrames\":{},\"outputChannels\":{}}}",
                telemetry.sample_position,
                telemetry.callback_count,
                telemetry.sample_rate,
                telemetry.callback_frames,
                telemetry.output_channels
            )?;
        } else {
            write!(self.writer, ",\"telemetry\":null")?;
        }

        writeln!(self.writer, "}}")?;
        Ok(())
    }

    fn drain_runtime_events(&mut self) -> Result<(), SessionError> {
        if let Some(driver) = &mut self.driver {
            let driver_events = driver.drain_events();
            let telemetry = driver.last_telemetry();

            for event in driver_events {
                self.write_driver_event(event)?;
            }

            if let Some(telemetry) = telemetry {
                self.last_telemetry = Some(telemetry);
            }
        }

        if let Some(receiver) = &self.telemetry_receiver {
            let mut events = Vec::new();

            while let Some(event) = receiver.pop() {
                events.push(event);
            }

            for event in events {
                self.write_engine_event(event)?;
            }
        }

        Ok(())
    }

    fn write_driver_event(&mut self, event: AudioDriverEvent) -> Result<(), SessionError> {
        match event {
            AudioDriverEvent::StreamStarted {
                sample_rate,
                channels,
            } => {
                writeln!(
                    self.writer,
                    "{{\"type\":\"audio:event\",\"event\":\"stream-started\",\"sampleRate\":{sample_rate},\"channels\":{channels}}}"
                )?;
            }
            AudioDriverEvent::StreamStopped => {
                writeln!(
                    self.writer,
                    "{{\"type\":\"audio:event\",\"event\":\"stream-stopped\"}}"
                )?;
            }
            AudioDriverEvent::StreamError { code } => {
                writeln!(
                    self.writer,
                    "{{\"type\":\"audio:event\",\"event\":\"stream-error\",\"code\":\"{:?}\"}}",
                    code
                )?;
            }
        }

        Ok(())
    }

    fn write_engine_event(&mut self, event: EngineEvent) -> Result<(), SessionError> {
        match event {
            EngineEvent::Telemetry(telemetry) => {
                self.last_telemetry = Some(telemetry);
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"telemetry\",\"samplePosition\":{},\"callbackCount\":{},\"sampleRate\":{},\"callbackFrames\":{},\"outputChannels\":{}}}",
                    telemetry.sample_position,
                    telemetry.callback_count,
                    telemetry.sample_rate,
                    telemetry.callback_frames,
                    telemetry.output_channels
                )?;
            }
            EngineEvent::TransportStateChanged { playing, at_sample } => {
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"transport-state\",\"playing\":{playing},\"atSample\":{at_sample}}}"
                )?;
            }
            EngineEvent::LifecycleStarted => {
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"lifecycle-started\"}}"
                )?;
            }
            EngineEvent::LifecycleStopped => {
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"lifecycle-stopped\"}}"
                )?;
            }
            other => {
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"{}\"}}",
                    escape_json(&format!("{other:?}"))
                )?;
            }
        }

        Ok(())
    }

    fn write_ok_prefix(
        &mut self,
        request: &SessionRequest,
        message_type: &str,
    ) -> Result<(), SessionError> {
        self.write_response_prefix(request.request_id, message_type, true)
    }

    fn write_response_prefix(
        &mut self,
        request_id: Option<u64>,
        message_type: &str,
        ok: bool,
    ) -> Result<(), SessionError> {
        write!(self.writer, "{{")?;

        if let Some(request_id) = request_id {
            write!(self.writer, "\"requestId\":{request_id},")?;
        }

        write!(
            self.writer,
            "\"type\":\"{}\",\"ok\":{}",
            escape_json(message_type),
            ok
        )?;
        Ok(())
    }

    fn write_error(
        &mut self,
        request_id: Option<u64>,
        message_type: &str,
        code: &str,
        message: &str,
    ) -> Result<(), SessionError> {
        self.write_response_prefix(request_id, message_type, false)?;
        writeln!(
            self.writer,
            ",\"code\":\"{}\",\"message\":\"{}\"}}",
            escape_json(code),
            escape_json(message)
        )?;
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionRequest {
    request_id: Option<u64>,
    command: String,
    options: Vec<(String, String)>,
}

impl SessionRequest {
    fn parse(line: &str) -> Self {
        if line.starts_with('{') {
            return Self::parse_json(line);
        }

        let mut parts = line.split_whitespace();
        let command = parts.next().unwrap_or_default().to_string();
        let options = parts
            .filter_map(|part| {
                let (key, value) = part.split_once('=')?;

                Some((key.to_string(), value.to_string()))
            })
            .collect();

        Self {
            request_id: None,
            command,
            options,
        }
    }

    fn parse_json(line: &str) -> Self {
        let fields = parse_flat_json_object(line);
        let command = fields
            .iter()
            .find(|(key, _)| key == "type")
            .map(|(_, value)| value.clone())
            .unwrap_or_default();
        let request_id = fields
            .iter()
            .find(|(key, _)| key == "requestId")
            .and_then(|(_, value)| value.parse::<u64>().ok());
        let options = fields
            .into_iter()
            .filter(|(key, _)| key != "type" && key != "requestId")
            .collect();

        Self {
            request_id,
            command,
            options,
        }
    }

    fn option(&self, key: &str) -> Option<&str> {
        self.options
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, value)| value.as_str())
    }

    fn driver(&self) -> DriverKind {
        match self.option("driver") {
            Some("cpal") => DriverKind::Cpal,
            _ => DriverKind::Null,
        }
    }

    fn parse_u32(&self, key: &str) -> Result<Option<u32>, SessionError> {
        self.option(key)
            .map(|value| {
                value.parse::<u32>().map_err(|_| {
                    SessionError::new(format!("invalid numeric value for {key}: {value}"))
                })
            })
            .transpose()
    }

    fn parse_u16(&self, key: &str) -> Result<Option<u16>, SessionError> {
        self.option(key)
            .map(|value| {
                value.parse::<u16>().map_err(|_| {
                    SessionError::new(format!("invalid numeric value for {key}: {value}"))
                })
            })
            .transpose()
    }
}

enum SessionDriver {
    Cpal(CpalAudioDriver),
    Null(NullAudioDriver),
}

impl AudioDriver for SessionDriver {
    fn available_output_devices(
        &self,
    ) -> Result<Vec<engine_audio_io::AudioDeviceInfo>, AudioDriverError> {
        match self {
            Self::Cpal(driver) => driver.available_output_devices(),
            Self::Null(driver) => driver.available_output_devices(),
        }
    }

    fn start_output(
        &mut self,
        request: OutputStreamRequest,
        processor: Box<dyn engine_audio_io::AudioProcessor>,
    ) -> Result<ActiveOutputStream, AudioDriverError> {
        match self {
            Self::Cpal(driver) => driver.start_output(request, processor),
            Self::Null(driver) => driver.start_output(request, processor),
        }
    }

    fn stop(&mut self) -> Result<(), AudioDriverError> {
        match self {
            Self::Cpal(driver) => driver.stop(),
            Self::Null(driver) => driver.stop(),
        }
    }

    fn drain_events(&mut self) -> Vec<AudioDriverEvent> {
        match self {
            Self::Cpal(driver) => driver.drain_events(),
            Self::Null(driver) => driver.drain_events(),
        }
    }
}

impl SessionDriver {
    fn last_telemetry(&self) -> Option<AudioTelemetry> {
        match self {
            Self::Cpal(_) => None,
            Self::Null(driver) => driver.last_telemetry(),
        }
    }
}

fn build_session_driver(kind: DriverKind) -> SessionDriver {
    match kind {
        DriverKind::Cpal => SessionDriver::Cpal(CpalAudioDriver::new()),
        DriverKind::Null => SessionDriver::Null(NullAudioDriver::new()),
    }
}

fn session_driver_error(error: AudioDriverError) -> SessionError {
    SessionError::new(format!("{:?}: {}", error.code, error.message))
}

fn optional_u32_json(value: Option<u32>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn parse_flat_json_object(line: &str) -> Vec<(String, String)> {
    let mut fields = Vec::new();
    let mut index = 0;
    let bytes = line.as_bytes();

    skip_ws(bytes, &mut index);
    if bytes.get(index) != Some(&b'{') {
        return fields;
    }
    index += 1;

    loop {
        skip_ws(bytes, &mut index);

        if bytes.get(index) == Some(&b'}') || index >= bytes.len() {
            break;
        }

        let Some(key) = parse_json_string(bytes, &mut index) else {
            break;
        };

        skip_ws(bytes, &mut index);
        if bytes.get(index) != Some(&b':') {
            break;
        }
        index += 1;
        skip_ws(bytes, &mut index);

        let value = if bytes.get(index) == Some(&b'"') {
            parse_json_string(bytes, &mut index).unwrap_or_default()
        } else {
            parse_json_scalar(bytes, &mut index)
        };

        fields.push((key, value));
        skip_ws(bytes, &mut index);

        match bytes.get(index) {
            Some(b',') => index += 1,
            Some(b'}') | None => break,
            _ => break,
        }
    }

    fields
}

fn parse_json_string(bytes: &[u8], index: &mut usize) -> Option<String> {
    if bytes.get(*index) != Some(&b'"') {
        return None;
    }
    *index += 1;
    let mut value = String::new();

    while let Some(byte) = bytes.get(*index).copied() {
        *index += 1;

        match byte {
            b'"' => return Some(value),
            b'\\' => {
                let escaped = bytes.get(*index).copied()?;
                *index += 1;
                match escaped {
                    b'"' => value.push('"'),
                    b'\\' => value.push('\\'),
                    b'n' => value.push('\n'),
                    b'r' => value.push('\r'),
                    b't' => value.push('\t'),
                    other => value.push(other as char),
                }
            }
            other => value.push(other as char),
        }
    }

    None
}

fn parse_json_scalar(bytes: &[u8], index: &mut usize) -> String {
    let start = *index;

    while let Some(byte) = bytes.get(*index) {
        if matches!(byte, b',' | b'}') {
            break;
        }
        *index += 1;
    }

    String::from_utf8_lossy(&bytes[start..*index])
        .trim()
        .to_string()
}

fn skip_ws(bytes: &[u8], index: &mut usize) {
    while bytes.get(*index).is_some_and(u8::is_ascii_whitespace) {
        *index += 1;
    }
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::new();

    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            other => escaped.push(other),
        }
    }

    escaped
}

impl DriverKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cpal => "cpal",
            Self::Null => "null",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn run_session(input: &str) -> String {
        let mut output = Vec::new();

        run_stdio_session(Cursor::new(input.as_bytes()), &mut output).unwrap();
        String::from_utf8(output).unwrap()
    }

    #[test]
    fn hello_reports_protocol_version() {
        let output = run_session("session:hello\nsession:shutdown\n");

        assert!(output.contains("\"type\":\"session:ready\""));
        assert!(output.contains("\"type\":\"session:hello\""));
        assert!(output.contains("\"protocolVersion\":1"));
    }

    #[test]
    fn null_driver_session_lists_starts_snapshots_and_stops() {
        let output = run_session(
            "audio:list-devices driver=null\n\
             audio:start driver=null sample_rate=48000 buffer_frames=128 channels=2\n\
             engine:snapshot\n\
             audio:stop\n\
             session:shutdown\n",
        );

        assert!(output.contains("\"type\":\"audio:devices\""));
        assert!(output.contains("\"id\":\"null\""));
        assert!(output.contains("\"type\":\"audio:started\""));
        assert!(output.contains("\"event\":\"stream-started\""));
        assert!(output.contains("\"type\":\"engine:snapshot\""));
        assert!(output.contains("\"samplePosition\":128"));
        assert!(output.contains("\"type\":\"audio:stopped\""));
    }

    #[test]
    fn json_requests_echo_request_ids() {
        let output = run_session(
            "{\"requestId\":1,\"type\":\"session:hello\"}\n\
             {\"requestId\":2,\"type\":\"audio:list-devices\",\"driver\":\"null\"}\n\
             {\"requestId\":3,\"type\":\"session:shutdown\"}\n",
        );

        assert!(output.contains("\"requestId\":1,\"type\":\"session:hello\""));
        assert!(output.contains("\"requestId\":2,\"type\":\"audio:devices\""));
        assert!(output.contains("\"requestId\":3,\"type\":\"session:shutdown\""));
    }
}
