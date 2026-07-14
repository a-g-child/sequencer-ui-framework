use std::{
    io::{BufRead, Write},
    thread,
    time::{Duration, Instant},
};

use engine_audio_io::{
    ActiveOutputStream, AudioDriver, AudioDriverError, AudioDriverEvent, CpalAudioDriver,
    EngineProcessor, NullAudioDriver, OutputStreamRequest,
};
use engine_core::{
    build_state_transfer, engine_command_queue, engine_telemetry_queue,
    prepared_plan_transfer_queue, retired_plan_queue, AudioEngine, EngineCommandSender,
    EngineTelemetryReceiver, PreparedExecutionPlan, PreparedExecutionPlanMetadata,
    PreparedPlanSender, PreparedPlanTransfer, RetiredPlanReceiver,
};
use engine_protocol::{
    diagnostic_tone_plan, event_endpoint, AudioBufferSlot, AudioTelemetry, CommandRejection,
    EngineCommand, EngineEvent, EventInputNodePlan, EventRoute, EventRouteMask, GainNodePlan,
    InstrumentNodePlan, NativeExecutionPlan, OutputNodePlan, ParameterSlot, PlanNode, PlanNodeKind,
    ScheduledBeatEvent, ScheduledEngineEvent, ScheduledEventLifetime, ScheduledEventOwner,
    TempoMapSnapshot, TransportLoop, NATIVE_EXECUTION_PLAN_VERSION, NODE_EVENT_INPUT, NODE_GAIN,
    NODE_INSTRUMENT, NODE_OUTPUT, PARAM_GAIN_GAIN,
};

use crate::DriverKind;

const SESSION_PROTOCOL_VERSION: u32 = 1;
const EXECUTION_PLAN_VERSION: u32 = 1;
const EVENT_GRAPH_VERSION: u32 = 1;
const PARAMETER_GRAPH_VERSION: u32 = 0;
const MAX_PREPARED_TRANSFERS: usize = 8;
const MAX_SCHEDULED_BEAT_BATCH_EVENTS: usize = 256;
const PLAN_ACTIVATION_TIMEOUT: Duration = Duration::from_millis(500);
const DEFAULT_MAXIMUM_PROCESS_FRAMES: usize = 2048;

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
    prepared_plan_sender: Option<PreparedPlanSender>,
    retired_plan_receiver: Option<RetiredPlanReceiver>,
    prepared_plans: Vec<SessionPreparedPlan>,
    active_plan_metadata: Option<PreparedExecutionPlanMetadata>,
    transport_playing: bool,
    transport_changed_at_sample: u64,
    tempo_map: TempoMapSnapshot,
    next_transfer_id: u64,
    next_command_id: u64,
    last_telemetry: Option<AudioTelemetry>,
    last_command_rejection: Option<(u64, CommandRejection)>,
    null_driver_last_pump_at: Option<Instant>,
    null_driver_frame_accumulator: f64,
}

struct SessionPreparedPlan {
    transfer_id: u64,
    metadata: PreparedExecutionPlanMetadata,
    plan: PreparedExecutionPlan,
}

struct PlanActivation {
    plan_id: u64,
    plan_revision: u64,
    requested_sample: u64,
    applied_sample: u64,
}

impl<W: Write> Session<W> {
    fn new(writer: W) -> Self {
        Self {
            writer,
            driver: None,
            stream: None,
            command_sender: None,
            telemetry_receiver: None,
            prepared_plan_sender: None,
            retired_plan_receiver: None,
            prepared_plans: Vec::new(),
            active_plan_metadata: None,
            transport_playing: false,
            transport_changed_at_sample: 0,
            tempo_map: TempoMapSnapshot::default(),
            next_transfer_id: 1,
            next_command_id: 1,
            last_telemetry: None,
            last_command_rejection: None,
            null_driver_last_pump_at: None,
            null_driver_frame_accumulator: 0.0,
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
            "plan:prepare" => self.prepare_plan(&request),
            "plan:activate" => self.activate_plan(&request),
            "engine:command" => self.send_engine_command(&request),
            "engine:snapshot" => self.write_snapshot(&request),
            "session:shutdown" => {
                if self.stream.is_some() {
                    self.stop_audio(&SessionRequest {
                        request_id: None,
                        command: "audio:stop".to_string(),
                        options: Vec::new(),
                        raw_line: String::new(),
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
            ",\"protocolVersion\":{SESSION_PROTOCOL_VERSION},\"host\":\"engine-host\",\"capabilities\":{}}}",
            session_capabilities_json()
        )?;
        Ok(())
    }

    fn write_capabilities(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        self.write_ok_prefix(request, "session:capabilities")?;
        writeln!(
            self.writer,
            ",\"protocolVersion\":{SESSION_PROTOCOL_VERSION},\"capabilities\":{},\"drivers\":[\"null\",\"cpal\"],\"messages\":[\"session:hello\",\"session:capabilities\",\"audio:list-devices\",\"audio:start\",\"audio:stop\",\"plan:prepare\",\"plan:activate\",\"engine:command\",\"engine:snapshot\",\"session:shutdown\"]}}",
            session_capabilities_json()
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
        let (prepared_sender, prepared_receiver) = prepared_plan_transfer_queue();
        let (retired_sender, retired_receiver) = retired_plan_queue();
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
        self.prepared_plan_sender = Some(prepared_sender);
        self.retired_plan_receiver = Some(retired_receiver);
        self.null_driver_last_pump_at = Some(Instant::now());
        self.null_driver_frame_accumulator = 0.0;
        self.prepared_plans.clear();
        self.active_plan_metadata = None;
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
        self.prepared_plan_sender = None;
        self.retired_plan_receiver = None;
        self.null_driver_last_pump_at = None;
        self.null_driver_frame_accumulator = 0.0;
        self.prepared_plans.clear();
        self.active_plan_metadata = None;
        self.transport_playing = false;
        self.write_ok_prefix(request, "audio:stopped")?;
        writeln!(self.writer, "}}")?;
        Ok(())
    }

    fn send_engine_command(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        if self.command_sender.is_none() {
            self.write_error(
                request.request_id,
                "error",
                "AudioNotRunning",
                "audio must be started before sending engine commands",
            )?;
            return Ok(());
        }

        let first_command_id = self.next_command_id;
        let commands = match parse_session_engine_commands(request, first_command_id) {
            Ok(commands) => commands,
            Err(error) => {
                self.write_error(
                    request.request_id,
                    "error",
                    "InvalidEngineCommand",
                    &error.message,
                )?;
                return Ok(());
            }
        };

        self.next_command_id = self.next_command_id.saturating_add(commands.len() as u64);

        for command in commands {
            self.observe_engine_command(command);

            if self
                .command_sender
                .as_ref()
                .expect("command sender checked above")
                .push(command)
                .is_err()
            {
                self.write_error(
                    request.request_id,
                    "error",
                    "CommandQueueFull",
                    "engine command queue is full",
                )?;
                return Ok(());
            }
        }

        if let Some(driver) = &mut self.driver {
            driver.process_one_block()?;
        }

        self.drain_runtime_events()?;
        self.write_ok_prefix(request, "engine:command")?;
        writeln!(self.writer, ",\"commandId\":{first_command_id}}}")?;
        Ok(())
    }

    fn observe_engine_command(&mut self, command: EngineCommand) {
        match command {
            EngineCommand::SetTempoMap { tempo, .. } => {
                self.tempo_map = tempo;
            }
            EngineCommand::TransportStop { .. } | EngineCommand::Panic { .. } => {
                self.transport_playing = false;
            }
            _ => {}
        }
    }

    fn prepare_plan(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        let Some(stream) = self.stream.as_ref() else {
            self.write_error(
                request.request_id,
                "error",
                "AudioNotRunning",
                "audio must be started before preparing an execution plan",
            )?;
            return Ok(());
        };

        if self.prepared_plans.len() >= MAX_PREPARED_TRANSFERS {
            self.write_error(
                request.request_id,
                "error",
                "PreparedPlanCapacityExceeded",
                "prepared plan handle capacity is full",
            )?;
            return Ok(());
        }

        let requested_frames = stream.requested_buffer_frames.unwrap_or(128).max(1) as usize;
        let maximum_frames = requested_frames.max(DEFAULT_MAXIMUM_PROCESS_FRAMES);
        let plan = match parse_session_execution_plan(request) {
            Ok(plan) => plan,
            Err(error) => {
                self.write_error(
                    request.request_id,
                    "error",
                    "InvalidExecutionPlan",
                    &error.message,
                )?;
                return Ok(());
            }
        };
        let prepared = match PreparedExecutionPlan::prepare(&plan, maximum_frames) {
            Ok(prepared) => prepared,
            Err(error) => {
                self.write_error(
                    request.request_id,
                    "error",
                    "PlanValidationError",
                    &format!("{error:?}"),
                )?;
                return Ok(());
            }
        };
        let transfer_id = self.next_transfer_id;
        let plan_id = prepared.plan_id();
        let plan_revision = prepared.plan_revision();
        let metadata = prepared.metadata();

        self.next_transfer_id = self.next_transfer_id.saturating_add(1);
        self.prepared_plans.push(SessionPreparedPlan {
            transfer_id,
            metadata,
            plan: prepared,
        });

        self.write_ok_prefix(request, "plan:prepared")?;
        writeln!(
            self.writer,
            ",\"handle\":{{\"transferId\":{transfer_id},\"planId\":{plan_id},\"revision\":{plan_revision}}}}}"
        )?;
        Ok(())
    }

    fn activate_plan(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        let Some(transfer_id) = request.parse_u64("transferId")? else {
            self.write_error(
                request.request_id,
                "error",
                "MissingTransferId",
                "plan activation requires transferId",
            )?;
            return Ok(());
        };
        let requested_sample = request.parse_u64("requestedSample")?.unwrap_or(0);

        if self.command_sender.is_none() || self.prepared_plan_sender.is_none() {
            self.write_error(
                request.request_id,
                "error",
                "AudioNotRunning",
                "audio must be started before activating an execution plan",
            )?;
            return Ok(());
        }

        let Some(prepared_index) = self
            .prepared_plans
            .iter()
            .position(|prepared| prepared.transfer_id == transfer_id)
        else {
            self.write_error(
                request.request_id,
                "error",
                "UnknownPreparedPlan",
                "prepared plan handle is missing or already consumed",
            )?;
            return Ok(());
        };

        let prepared = self.prepared_plans.swap_remove(prepared_index);
        let state_transfer = match &self.active_plan_metadata {
            Some(active_metadata) => {
                match build_state_transfer(active_metadata, &prepared.metadata) {
                    Ok(transfer) => transfer,
                    Err(error) => {
                        self.write_error(
                            request.request_id,
                            "error",
                            "StateTransferPlanningError",
                            &format!("{error:?}"),
                        )?;
                        return Ok(());
                    }
                }
            }
            None => engine_core::PlanStateTransfer::empty(),
        };
        let metadata = prepared.metadata.clone();
        let command_id = self.next_command_id;
        let transfer = PreparedPlanTransfer::new(transfer_id, prepared.plan, state_transfer);

        self.next_command_id = self.next_command_id.saturating_add(1);

        if self
            .prepared_plan_sender
            .as_ref()
            .expect("prepared plan sender checked above")
            .push(transfer)
            .is_err()
        {
            self.write_error(
                request.request_id,
                "error",
                "PreparedPlanQueueFull",
                "prepared plan transfer queue is full",
            )?;
            return Ok(());
        }

        if self
            .command_sender
            .as_ref()
            .expect("command sender checked above")
            .push(EngineCommand::SwapExecutionPlan {
                id: command_id,
                transfer_id,
                requested_sample,
            })
            .is_err()
        {
            self.write_error(
                request.request_id,
                "error",
                "CommandQueueFull",
                "engine command queue is full",
            )?;
            return Ok(());
        }

        let activation = match self.wait_for_plan_activation(command_id) {
            Ok(activation) => activation,
            Err(error) => {
                self.write_error(
                    request.request_id,
                    "error",
                    "PlanActivationFailed",
                    &error.message,
                )?;
                return Ok(());
            }
        };

        self.active_plan_metadata = Some(metadata);
        self.write_ok_prefix(request, "plan:activated")?;
        writeln!(
            self.writer,
            ",\"planId\":{},\"revision\":{},\"requestedSample\":{},\"appliedSample\":{}}}",
            activation.plan_id,
            activation.plan_revision,
            activation.requested_sample,
            activation.applied_sample
        )?;
        Ok(())
    }

    fn write_snapshot(&mut self, request: &SessionRequest) -> Result<(), SessionError> {
        self.process_driver_for_snapshot()?;

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
            let plan_status = telemetry.runtime_plan_status;
            let beat_position = if self.transport_playing {
                self.tempo_map.sample_to_beat(telemetry.sample_position)
            } else {
                0.0
            };
            let command_diagnostics = telemetry.command_diagnostics;
            let scheduler_diagnostics = telemetry.scheduler_diagnostics;
            let scheduler_diagnostics_json =
                scheduler_diagnostics_json(scheduler_diagnostics);
            let event_graph_diagnostics_json =
                event_graph_diagnostics_json(telemetry.event_graph_diagnostics);
            write!(
                self.writer,
                ",\"transport\":{{\"playing\":{},\"samplePosition\":{},\"beatPosition\":{},\"loopIteration\":0}},\"plan\":{{\"activePlanId\":{},\"activeRevision\":{},\"planMaximumFrames\":{},\"pendingTransfers\":{},\"successfulSwaps\":{},\"rejectedSwaps\":{}}},\"diagnostics\":{{\"xruns\":{},\"queueOverflows\":{},\"streamErrors\":{},\"callbackFrames\":{},\"maximumCallbackFrames\":{},\"commandQueueDepth\":{},\"pendingCommandCount\":{},\"nextPendingCommandSample\":{},\"commandReceived\":{},\"commandApplied\":{},\"commandLate\":{},\"commandRejected\":{},\"commandOutOfOrder\":{},\"lastCommandRejection\":{},\"scheduler\":{},\"eventGraph\":{}}},\"telemetry\":{{\"samplePosition\":{},\"callbackCount\":{},\"sampleRate\":{},\"callbackFrames\":{},\"maximumCallbackFrames\":{},\"outputChannels\":{},\"commandQueueDepth\":{},\"pendingCommandCount\":{},\"nextPendingCommandSample\":{},\"commandDiagnostics\":{{\"received\":{},\"applied\":{},\"late\":{},\"rejected\":{},\"outOfOrder\":{},\"commandQueueOverflows\":{},\"telemetryQueueOverflows\":{}}},\"schedulerDiagnostics\":{},\"eventGraphDiagnostics\":{},\"plan\":{{\"activePlanId\":{},\"activeRevision\":{},\"planMaximumFrames\":{},\"pendingPlanCount\":{},\"successfulSwaps\":{},\"rejectedSwaps\":{}}}}}",
                self.transport_playing,
                telemetry.sample_position,
                beat_position,
                optional_u64_json(plan_status.active_plan_id),
                optional_u64_json(plan_status.active_plan_revision),
                optional_u32_json(plan_status.active_plan_maximum_frames),
                plan_status
                    .pending_plan_count
                    .saturating_add(self.prepared_plans.len() as u32),
                plan_status.successful_swaps,
                plan_status.rejected_swaps,
                telemetry.probable_xruns,
                telemetry.command_diagnostics.command_queue_overflows
                    .saturating_add(telemetry.command_diagnostics.telemetry_queue_overflows),
                telemetry.stream_errors,
                telemetry.callback_frames,
                telemetry.maximum_callback_frames,
                telemetry.command_queue_depth,
                telemetry.pending_command_count,
                optional_u64_json(telemetry.next_pending_command_sample),
                command_diagnostics.received,
                command_diagnostics.applied,
                command_diagnostics.late,
                command_diagnostics.rejected,
                command_diagnostics.out_of_order,
                last_command_rejection_json(self.last_command_rejection),
                scheduler_diagnostics_json,
                event_graph_diagnostics_json,
                telemetry.sample_position,
                telemetry.callback_count,
                telemetry.sample_rate,
                telemetry.callback_frames,
                telemetry.maximum_callback_frames,
                telemetry.output_channels,
                telemetry.command_queue_depth,
                telemetry.pending_command_count,
                optional_u64_json(telemetry.next_pending_command_sample),
                command_diagnostics.received,
                command_diagnostics.applied,
                command_diagnostics.late,
                command_diagnostics.rejected,
                command_diagnostics.out_of_order,
                command_diagnostics.command_queue_overflows,
                command_diagnostics.telemetry_queue_overflows,
                scheduler_diagnostics_json,
                event_graph_diagnostics_json,
                optional_u64_json(plan_status.active_plan_id),
                optional_u64_json(plan_status.active_plan_revision),
                optional_u32_json(plan_status.active_plan_maximum_frames),
                plan_status
                    .pending_plan_count
                    .saturating_add(self.prepared_plans.len() as u32),
                plan_status.successful_swaps,
                plan_status.rejected_swaps
            )?;
        } else {
            write!(self.writer, ",\"telemetry\":null")?;
        }

        writeln!(self.writer, "}}")?;
        Ok(())
    }

    fn process_driver_for_snapshot(&mut self) -> Result<(), SessionError> {
        let Some(driver) = &mut self.driver else {
            return Ok(());
        };

        if !driver.is_null() {
            return Ok(());
        }

        let Some(stream) = self.stream.as_ref() else {
            return Ok(());
        };

        let now = Instant::now();
        let last = self.null_driver_last_pump_at.get_or_insert(now);
        let elapsed = now.saturating_duration_since(*last);
        *last = now;

        self.null_driver_frame_accumulator +=
            elapsed.as_secs_f64() * f64::from(stream.sample_rate.max(1));

        let frames_per_block = f64::from(stream.requested_buffer_frames.unwrap_or(128).max(1));
        let block_count = (self.null_driver_frame_accumulator / frames_per_block).floor() as usize;

        if block_count == 0 {
            return Ok(());
        }

        self.null_driver_frame_accumulator -= block_count as f64 * frames_per_block;
        driver.process_blocks(block_count)
    }

    fn drain_runtime_events(&mut self) -> Result<(), SessionError> {
        if let Some(driver) = &mut self.driver {
            let driver_events = driver.drain_events();
            let telemetry = driver.last_telemetry();

            for event in driver_events {
                self.write_driver_event(event)?;
            }

            if let Some(telemetry) = telemetry {
                self.last_telemetry = Some(merge_driver_telemetry(self.last_telemetry, telemetry));
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

        self.drain_retired_plans();

        Ok(())
    }

    fn drain_retired_plans(&mut self) {
        if let Some(receiver) = &self.retired_plan_receiver {
            while let Some(retired) = receiver.pop() {
                drop(retired);
            }
        }
    }

    fn wait_for_plan_activation(
        &mut self,
        command_id: u64,
    ) -> Result<PlanActivation, SessionError> {
        let deadline = Instant::now() + PLAN_ACTIVATION_TIMEOUT;

        loop {
            if let Some(driver) = &mut self.driver {
                driver.process_one_block()?;
            }

            if let Some(driver) = &mut self.driver {
                let driver_events = driver.drain_events();
                let telemetry = driver.last_telemetry();

                for event in driver_events {
                    self.write_driver_event(event)?;
                }

                if let Some(telemetry) = telemetry {
                    self.last_telemetry =
                        Some(merge_driver_telemetry(self.last_telemetry, telemetry));
                }
            }

            if let Some(receiver) = &self.telemetry_receiver {
                let mut events = Vec::new();

                while let Some(event) = receiver.pop() {
                    events.push(event);
                }

                for event in events {
                    match event {
                        EngineEvent::ExecutionPlanSwapped {
                            command_id: event_command_id,
                            plan_id,
                            plan_revision,
                            requested_sample,
                            applied_sample,
                        } => {
                            self.write_engine_event(event)?;

                            if event_command_id == command_id {
                                self.drain_retired_plans();
                                return Ok(PlanActivation {
                                    plan_id,
                                    plan_revision,
                                    requested_sample,
                                    applied_sample,
                                });
                            }
                        }
                        EngineEvent::CommandRejected {
                            command_id: event_command_id,
                            reason,
                        } => {
                            self.write_engine_event(event)?;

                            if event_command_id == command_id {
                                return Err(SessionError::new(format!(
                                    "swap command rejected: {reason:?}"
                                )));
                            }
                        }
                        other => self.write_engine_event(other)?,
                    }
                }
            }

            if Instant::now() >= deadline {
                return Err(SessionError::new("timed out waiting for plan activation"));
            }

            thread::sleep(Duration::from_millis(5));
        }
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
                self.transport_playing = playing;
                self.transport_changed_at_sample = at_sample;
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"transport-state\",\"playing\":{playing},\"atSample\":{at_sample}}}"
                )?;
            }
            EngineEvent::ExecutionPlanSwapped {
                plan_id,
                plan_revision,
                ..
            } => {
                let mut telemetry = self.last_telemetry.unwrap_or_default();

                telemetry.runtime_plan_status.active_plan_id = Some(plan_id);
                telemetry.runtime_plan_status.active_plan_revision = Some(plan_revision);
                telemetry.runtime_plan_status.pending_plan_count = 0;
                telemetry.runtime_plan_status.successful_swaps = telemetry
                    .runtime_plan_status
                    .successful_swaps
                    .saturating_add(1);
                self.last_telemetry = Some(telemetry);
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"{}\"}}",
                    escape_json(&format!(
                        "ExecutionPlanSwapped {{ plan_id: {plan_id}, plan_revision: {plan_revision} }}"
                    ))
                )?;
            }
            EngineEvent::CommandRejected { command_id, reason } => {
                self.last_command_rejection = Some((command_id, reason));
                writeln!(
                    self.writer,
                    "{{\"type\":\"engine:event\",\"event\":\"command-rejected\",\"commandId\":{command_id},\"reason\":\"{reason:?}\"}}"
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
    raw_line: String,
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
            raw_line: line.to_string(),
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
            raw_line: line.to_string(),
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

    fn parse_u64(&self, key: &str) -> Result<Option<u64>, SessionError> {
        self.option(key)
            .map(|value| {
                value.parse::<u64>().map_err(|_| {
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
    fn is_null(&self) -> bool {
        matches!(self, Self::Null(_))
    }

    fn last_telemetry(&self) -> Option<AudioTelemetry> {
        match self {
            Self::Cpal(driver) => driver.last_telemetry(),
            Self::Null(driver) => driver.last_telemetry(),
        }
    }

    fn process_one_block(&mut self) -> Result<(), SessionError> {
        match self {
            Self::Cpal(_) => Ok(()),
            Self::Null(driver) => driver.process_blocks(1).map_err(session_driver_error),
        }
    }

    fn process_blocks(&mut self, block_count: usize) -> Result<(), SessionError> {
        match self {
            Self::Cpal(_) => Ok(()),
            Self::Null(driver) => driver
                .process_blocks(block_count)
                .map_err(session_driver_error),
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

fn optional_u64_json(value: Option<u64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn last_command_rejection_json(value: Option<(u64, CommandRejection)>) -> String {
    value
        .map(|(command_id, reason)| {
            format!("{{\"commandId\":{command_id},\"reason\":\"{reason:?}\"}}")
        })
        .unwrap_or_else(|| "null".to_string())
}

fn scheduler_diagnostics_json(
    diagnostics: engine_protocol::SchedulerDiagnostics,
) -> String {
    format!(
        "{{\"ownerGenerationsSet\":{},\"sampleEventsInserted\":{},\"beatEventsInserted\":{},\"beatEventMinSample\":{},\"beatEventMaxSample\":{},\"firstScheduledEventVisitedSample\":{},\"firstScheduledEventDispatchedSample\":{},\"eventsDroppedCapacity\":{},\"eventsDroppedNotPlaying\":{},\"eventsSuppressedWhileStopped\":{},\"eventsDiscardedOwner\":{},\"eventsDiscardedFutureOwner\":{},\"noteOnsDispatched\":{},\"noteOffsDispatched\":{},\"loopReschedules\":{},\"loopRescheduleSkippedDisabled\":{},\"loopRescheduleSkippedOutside\":{},\"eventsCleared\":{},\"transportLoopEnabled\":{},\"transportLoopStartSample\":{},\"transportLoopEndSample\":{}}}",
        diagnostics.owner_generations_set,
        diagnostics.sample_events_inserted,
        diagnostics.beat_events_inserted,
        optional_u64_json(diagnostics.beat_event_min_sample),
        optional_u64_json(diagnostics.beat_event_max_sample),
        optional_u64_json(diagnostics.first_scheduled_event_visited_sample),
        optional_u64_json(diagnostics.first_scheduled_event_dispatched_sample),
        diagnostics.events_dropped_capacity,
        diagnostics.events_dropped_not_playing,
        diagnostics.events_suppressed_while_stopped,
        diagnostics.events_discarded_owner,
        diagnostics.events_discarded_future_owner,
        diagnostics.note_ons_dispatched,
        diagnostics.note_offs_dispatched,
        diagnostics.loop_reschedules,
        diagnostics.loop_reschedule_skipped_disabled,
        diagnostics.loop_reschedule_skipped_outside,
        diagnostics.events_cleared,
        diagnostics.transport_loop_enabled,
        diagnostics.transport_loop_start_sample,
        diagnostics.transport_loop_end_sample,
    )
}

fn event_graph_diagnostics_json(
    diagnostics: engine_protocol::EventGraphDiagnostics,
) -> String {
    format!(
        "{{\"eventsReceived\":{},\"routeDispatches\":{},\"eventsEmitted\":{},\"eventsSuppressed\":{},\"eventsDroppedCapacity\":{},\"eventsDroppedDepth\":{},\"eventsDroppedBudget\":{},\"futureEventsRequested\":{},\"futureEventsRejectedLate\":{},\"futureEventsDroppedCapacity\":{},\"futureEventsDroppedSchedulerFull\":{},\"futureEventsDiscardedPlanRevision\":{},\"futureEventsDiscardedGeneration\":{}}}",
        diagnostics.events_received,
        diagnostics.route_dispatches,
        diagnostics.events_emitted,
        diagnostics.events_suppressed,
        diagnostics.events_dropped_capacity,
        diagnostics.events_dropped_depth,
        diagnostics.events_dropped_budget,
        diagnostics.future_events_requested,
        diagnostics.future_events_rejected_late,
        diagnostics.future_events_dropped_capacity,
        diagnostics.future_events_dropped_scheduler_full,
        diagnostics.future_events_discarded_plan_revision,
        diagnostics.future_events_discarded_generation,
    )
}

fn merge_driver_telemetry(
    previous: Option<AudioTelemetry>,
    driver: AudioTelemetry,
) -> AudioTelemetry {
    let Some(previous) = previous else {
        return driver;
    };

    AudioTelemetry {
        command_diagnostics: if driver.command_diagnostics
            == engine_protocol::CommandDiagnostics::default()
        {
            previous.command_diagnostics
        } else {
            driver.command_diagnostics
        },
        runtime_plan_status: if driver.runtime_plan_status
            == engine_protocol::RuntimePlanStatus::default()
        {
            previous.runtime_plan_status
        } else {
            driver.runtime_plan_status
        },
        scheduler_diagnostics: if driver.scheduler_diagnostics
            == engine_protocol::SchedulerDiagnostics::default()
        {
            previous.scheduler_diagnostics
        } else {
            driver.scheduler_diagnostics
        },
        event_graph_diagnostics: if driver.event_graph_diagnostics
            == engine_protocol::EventGraphDiagnostics::default()
        {
            previous.event_graph_diagnostics
        } else {
            driver.event_graph_diagnostics
        },
        ..driver
    }
}

fn parse_session_execution_plan(
    request: &SessionRequest,
) -> Result<engine_protocol::NativeExecutionPlan, SessionError> {
    let plan_json = extract_json_value(&request.raw_line, "plan")
        .ok_or_else(|| SessionError::new("plan:prepare requires a plan object"))?;
    let fields = parse_flat_json_object(&plan_json);
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };

    let version = parse_required_u32(field("version"), "plan.version")?;
    if version != NATIVE_EXECUTION_PLAN_VERSION {
        return Err(SessionError::new(format!(
            "unsupported execution plan version {version}"
        )));
    }

    match field("kind") {
        Some("diagnostic-tone") => {
            let frequency_hz = parse_required_f32(field("frequencyHz"), "plan.frequencyHz")?;
            let gain = parse_required_f32(field("gain"), "plan.gain")?;
            let output_channels =
                parse_required_u16(field("outputChannels"), "plan.outputChannels")?;
            let mut plan = diagnostic_tone_plan(frequency_hz, gain, output_channels);

            plan.plan_id = parse_required_u64(field("planId"), "plan.planId")?;
            plan.plan_revision = parse_required_u64(field("planRevision"), "plan.planRevision")?;

            Ok(plan)
        }
        Some("instrument-gain-output") => {
            let plan_id = parse_required_u64(field("planId"), "plan.planId")?;
            let plan_revision = parse_required_u64(field("planRevision"), "plan.planRevision")?;
            let gain = parse_optional_f32(field("gain"), "plan.gain")?.unwrap_or(0.25);
            let voice_count =
                parse_optional_u16(field("voiceCount"), "plan.voiceCount")?.unwrap_or(8);
            let output_channels =
                parse_optional_u16(field("outputChannels"), "plan.outputChannels")?.unwrap_or(2);

            Ok(instrument_gain_output_plan(
                plan_id,
                plan_revision,
                gain,
                voice_count,
                output_channels,
            ))
        }
        Some(kind) => Err(SessionError::new(format!("unsupported plan kind: {kind}"))),
        None => Err(SessionError::new("plan.kind is required")),
    }
}

fn instrument_gain_output_plan(
    plan_id: u64,
    plan_revision: u64,
    gain: f32,
    voice_count: u16,
    output_channels: u16,
) -> NativeExecutionPlan {
    NativeExecutionPlan {
        version: NATIVE_EXECUTION_PLAN_VERSION,
        plan_id,
        plan_revision,
        nodes: vec![
            PlanNode {
                id: NODE_EVENT_INPUT,
                kind: PlanNodeKind::EventInput(EventInputNodePlan),
            },
            PlanNode {
                id: NODE_INSTRUMENT,
                kind: PlanNodeKind::Instrument(InstrumentNodePlan {
                    output_buffer: 1,
                    voice_count,
                    attack_seconds: 0.0,
                    decay_seconds: 0.0,
                    sustain_level: 1.0,
                    release_seconds: 0.0,
                }),
            },
            PlanNode {
                id: NODE_GAIN,
                kind: PlanNodeKind::Gain(GainNodePlan {
                    gain_parameter: PARAM_GAIN_GAIN,
                    input_buffer: 1,
                    output_buffer: 2,
                }),
            },
            PlanNode {
                id: NODE_OUTPUT,
                kind: PlanNodeKind::Output(OutputNodePlan {
                    input_buffer: 2,
                    output_channels,
                }),
            },
        ],
        buffers: vec![
            AudioBufferSlot { id: 1, channels: 1 },
            AudioBufferSlot { id: 2, channels: 1 },
        ],
        parameters: vec![ParameterSlot {
            id: PARAM_GAIN_GAIN,
            node: NODE_GAIN,
            parameter: PARAM_GAIN_GAIN,
            default_value: gain,
        }],
        event_routes: vec![EventRoute {
            source: event_endpoint(NODE_EVENT_INPUT),
            destination: event_endpoint(NODE_INSTRUMENT),
            event_mask: EventRouteMask::NOTE,
            priority: 0,
            enabled: true,
        }],
        audio_execution_order: vec![NODE_INSTRUMENT, NODE_GAIN, NODE_OUTPUT],
    }
}

fn parse_session_engine_commands(
    request: &SessionRequest,
    first_command_id: u64,
) -> Result<Vec<EngineCommand>, SessionError> {
    let command_json = extract_json_value(&request.raw_line, "command")
        .ok_or_else(|| SessionError::new("engine:command requires a command object"))?;
    let fields = parse_flat_json_object(&command_json);
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };
    let at_sample = parse_optional_u64(field("atSample"), "command.atSample")?.unwrap_or(0);

    let command = match field("type") {
        Some("transport:start") => EngineCommand::TransportStart {
            id: first_command_id,
            at_sample,
        },
        Some("transport:stop") => EngineCommand::TransportStop {
            id: first_command_id,
            at_sample,
        },
        Some("panic") => EngineCommand::Panic {
            id: first_command_id,
            at_sample,
        },
        Some("tempo-map:set") => {
            let tempo = TempoMapSnapshot {
                origin_sample: parse_optional_u64(field("originSample"), "command.originSample")?
                    .unwrap_or(0),
                origin_beat: parse_optional_f64(field("originBeat"), "command.originBeat")?
                    .unwrap_or(0.0),
                bpm: parse_required_f64(field("bpm"), "command.bpm")?,
                sample_rate: parse_required_f64(field("sampleRate"), "command.sampleRate")?,
            };

            EngineCommand::SetTempoMap {
                id: first_command_id,
                tempo,
                at_sample,
            }
        }
        Some("transport-loop:set") => {
            let transport_loop = TransportLoop {
                enabled: parse_required_bool(field("enabled"), "command.enabled")?,
                start_sample: parse_required_u64(field("startSample"), "command.startSample")?,
                end_sample: parse_required_u64(field("endSample"), "command.endSample")?,
            };

            EngineCommand::SetTransportLoop {
                id: first_command_id,
                transport_loop,
                at_sample,
            }
        }
        Some("event-owner:generation:set") => {
            let clip_id =
                field("clipId").ok_or_else(|| SessionError::new("command.clipId is required"))?;
            let generation = parse_required_u64(field("generation"), "command.generation")?;

            EngineCommand::SetScheduledEventOwnerGeneration {
                id: first_command_id,
                owner_id: stable_owner_id(clip_id),
                generation,
                at_sample,
            }
        }
        Some("event:schedule-beat") => {
            let event = parse_scheduled_beat_event(&command_json)?;

            EngineCommand::ScheduleBeatEvent {
                id: first_command_id,
                event,
                owner: None,
                at_sample,
            }
        }
        Some("event:schedule-sample") => {
            let event = parse_scheduled_sample_event(&command_json)?;

            EngineCommand::ScheduleEvent {
                id: first_command_id,
                event,
            }
        }
        Some("event:schedule-beat-batch") => {
            return parse_scheduled_beat_event_batch(&command_json, first_command_id, at_sample);
        }
        Some(kind) => Err(SessionError::new(format!(
            "unsupported engine command type: {kind}"
        )))?,
        None => Err(SessionError::new("command.type is required"))?,
    };

    Ok(vec![command])
}

fn parse_scheduled_beat_event(command_json: &str) -> Result<ScheduledBeatEvent, SessionError> {
    let event_json = extract_json_value(command_json, "event")
        .ok_or_else(|| SessionError::new("command.event is required"))?;
    let fields = parse_flat_json_object(&event_json);
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };

    let target_node = parse_required_u32(field("targetNode"), "command.event.targetNode")?;
    let note = parse_required_u8(field("note"), "command.event.note")?;
    let at_beat = parse_required_f64(field("atBeat"), "command.event.atBeat")?;

    match field("kind") {
        Some("note-on") => Ok(ScheduledBeatEvent::NoteOn {
            target_node,
            note,
            velocity: parse_required_f32(field("velocity"), "command.event.velocity")?,
            at_beat,
        }),
        Some("note-off") => Ok(ScheduledBeatEvent::NoteOff {
            target_node,
            note,
            at_beat,
        }),
        Some(kind) => Err(SessionError::new(format!(
            "unsupported scheduled beat event kind: {kind}"
        ))),
        None => Err(SessionError::new("command.event.kind is required")),
    }
}

fn parse_scheduled_sample_event(command_json: &str) -> Result<ScheduledEngineEvent, SessionError> {
    let event_json = extract_json_value(command_json, "event")
        .ok_or_else(|| SessionError::new("command.event is required"))?;
    parse_scheduled_sample_event_object(&event_json)
}

fn parse_scheduled_beat_event_batch(
    command_json: &str,
    first_command_id: u64,
    at_sample: u64,
) -> Result<Vec<EngineCommand>, SessionError> {
    let fields = parse_flat_json_object(command_json);
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };
    let clip_id = field("clipId").ok_or_else(|| SessionError::new("command.clipId is required"))?;
    let generation = parse_required_u64(field("generation"), "command.generation")?;
    let owner_id = stable_owner_id(clip_id);
    let event_json = extract_json_value(command_json, "events")
        .ok_or_else(|| SessionError::new("command.events is required"))?;
    let event_objects = parse_json_object_array(&event_json);

    if event_objects.is_empty() {
        return Err(SessionError::new("command.events must not be empty"));
    }
    if event_objects.len() > MAX_SCHEDULED_BEAT_BATCH_EVENTS {
        return Err(SessionError::new(format!(
            "command.events exceeds maximum batch size {MAX_SCHEDULED_BEAT_BATCH_EVENTS}"
        )));
    }

    let mut commands = Vec::with_capacity(event_objects.len() + 1);
    commands.push(EngineCommand::SetScheduledEventOwnerGeneration {
        id: first_command_id,
        owner_id,
        generation,
        at_sample,
    });

    for (index, event_json) in event_objects.iter().enumerate() {
        let event = parse_scheduled_beat_event_object(event_json)?;
        let owner = match parse_scheduled_event_owner_lifetime(event_json)? {
            ScheduledEventLifetime::GenerationBound => {
                ScheduledEventOwner::generation_bound(owner_id, generation)
            }
            ScheduledEventLifetime::CompletionRequired => {
                ScheduledEventOwner::completion_required(owner_id, generation)
            }
        };

        commands.push(EngineCommand::ScheduleBeatEvent {
            id: first_command_id.saturating_add(index as u64 + 1),
            event,
            owner: Some(owner),
            at_sample,
        });
    }

    Ok(commands)
}

fn parse_scheduled_event_owner_lifetime(
    event_json: &str,
) -> Result<ScheduledEventLifetime, SessionError> {
    let fields = parse_flat_json_object(event_json);
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };

    match field("ownerLifetime") {
        Some("completion-required") => Ok(ScheduledEventLifetime::CompletionRequired),
        Some("generation-bound") | None => Ok(ScheduledEventLifetime::GenerationBound),
        Some(lifetime) => Err(SessionError::new(format!(
            "unsupported scheduled event owner lifetime: {lifetime}"
        ))),
    }
}

fn parse_scheduled_beat_event_object(event_json: &str) -> Result<ScheduledBeatEvent, SessionError> {
    let fields = parse_flat_json_object(event_json);
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };

    let target_node = parse_required_u32(field("targetNode"), "command.event.targetNode")?;
    let note = parse_required_u8(field("note"), "command.event.note")?;
    let at_beat = parse_required_f64(field("atBeat"), "command.event.atBeat")?;

    match field("kind") {
        Some("note-on") => Ok(ScheduledBeatEvent::NoteOn {
            target_node,
            note,
            velocity: parse_required_f32(field("velocity"), "command.event.velocity")?,
            at_beat,
        }),
        Some("note-off") => Ok(ScheduledBeatEvent::NoteOff {
            target_node,
            note,
            at_beat,
        }),
        Some(kind) => Err(SessionError::new(format!(
            "unsupported scheduled beat event kind: {kind}"
        ))),
        None => Err(SessionError::new("command.event.kind is required")),
    }
}

fn parse_scheduled_sample_event_object(
    event_json: &str,
) -> Result<ScheduledEngineEvent, SessionError> {
    let fields = parse_flat_json_object(event_json);
    let field = |name: &str| {
        fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };

    let target_node = parse_required_u32(field("targetNode"), "command.event.targetNode")?;
    let note = parse_required_u8(field("note"), "command.event.note")?;
    let at_sample = parse_required_u64(field("atSample"), "command.event.atSample")?;

    match field("kind") {
        Some("note-on") => Ok(ScheduledEngineEvent::NoteOn {
            target_node,
            note,
            velocity: parse_required_f32(field("velocity"), "command.event.velocity")?,
            at_sample,
        }),
        Some("note-off") => Ok(ScheduledEngineEvent::NoteOff {
            target_node,
            note,
            at_sample,
        }),
        Some(kind) => Err(SessionError::new(format!(
            "unsupported scheduled sample event kind: {kind}"
        ))),
        None => Err(SessionError::new("command.event.kind is required")),
    }
}

fn parse_required_u16(value: Option<&str>, name: &str) -> Result<u16, SessionError> {
    value
        .ok_or_else(|| SessionError::new(format!("{name} is required")))?
        .parse::<u16>()
        .map_err(|_| SessionError::new(format!("{name} must be a u16")))
}

fn parse_optional_u16(value: Option<&str>, name: &str) -> Result<Option<u16>, SessionError> {
    value
        .map(|value| {
            value
                .parse::<u16>()
                .map_err(|_| SessionError::new(format!("{name} must be a u16")))
        })
        .transpose()
}

fn parse_required_u32(value: Option<&str>, name: &str) -> Result<u32, SessionError> {
    value
        .ok_or_else(|| SessionError::new(format!("{name} is required")))?
        .parse::<u32>()
        .map_err(|_| SessionError::new(format!("{name} must be a u32")))
}

fn parse_required_u8(value: Option<&str>, name: &str) -> Result<u8, SessionError> {
    value
        .ok_or_else(|| SessionError::new(format!("{name} is required")))?
        .parse::<u8>()
        .map_err(|_| SessionError::new(format!("{name} must be a u8")))
}

fn parse_required_u64(value: Option<&str>, name: &str) -> Result<u64, SessionError> {
    value
        .ok_or_else(|| SessionError::new(format!("{name} is required")))?
        .parse::<u64>()
        .map_err(|_| SessionError::new(format!("{name} must be a u64")))
}

fn parse_optional_u64(value: Option<&str>, name: &str) -> Result<Option<u64>, SessionError> {
    value
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| SessionError::new(format!("{name} must be a u64")))
        })
        .transpose()
}

fn parse_required_bool(value: Option<&str>, name: &str) -> Result<bool, SessionError> {
    match value {
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => Err(SessionError::new(format!("{name} must be a boolean"))),
        None => Err(SessionError::new(format!("{name} is required"))),
    }
}

fn parse_required_f64(value: Option<&str>, name: &str) -> Result<f64, SessionError> {
    let parsed = value
        .ok_or_else(|| SessionError::new(format!("{name} is required")))?
        .parse::<f64>()
        .map_err(|_| SessionError::new(format!("{name} must be a finite f64")))?;

    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(SessionError::new(format!("{name} must be finite")))
    }
}

fn parse_optional_f64(value: Option<&str>, name: &str) -> Result<Option<f64>, SessionError> {
    value
        .map(|value| {
            let parsed = value
                .parse::<f64>()
                .map_err(|_| SessionError::new(format!("{name} must be a finite f64")))?;

            if parsed.is_finite() {
                Ok(parsed)
            } else {
                Err(SessionError::new(format!("{name} must be finite")))
            }
        })
        .transpose()
}

fn parse_required_f32(value: Option<&str>, name: &str) -> Result<f32, SessionError> {
    let parsed = value
        .ok_or_else(|| SessionError::new(format!("{name} is required")))?
        .parse::<f32>()
        .map_err(|_| SessionError::new(format!("{name} must be a finite f32")))?;

    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(SessionError::new(format!("{name} must be finite")))
    }
}

fn parse_optional_f32(value: Option<&str>, name: &str) -> Result<Option<f32>, SessionError> {
    value
        .map(|value| {
            let parsed = value
                .parse::<f32>()
                .map_err(|_| SessionError::new(format!("{name} must be a finite f32")))?;

            if parsed.is_finite() {
                Ok(parsed)
            } else {
                Err(SessionError::new(format!("{name} must be finite")))
            }
        })
        .transpose()
}

fn extract_json_value(line: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{key}\"");
    let key_index = line.find(&pattern)?;
    let mut index = key_index + pattern.len();
    let bytes = line.as_bytes();

    skip_ws(bytes, &mut index);
    if bytes.get(index) != Some(&b':') {
        return None;
    }
    index += 1;
    skip_ws(bytes, &mut index);

    let start = index;
    match bytes.get(index).copied()? {
        b'{' => {
            let mut depth = 0usize;
            let mut in_string = false;
            let mut escaped = false;

            while let Some(byte) = bytes.get(index).copied() {
                if in_string {
                    if escaped {
                        escaped = false;
                    } else if byte == b'\\' {
                        escaped = true;
                    } else if byte == b'"' {
                        in_string = false;
                    }
                } else if byte == b'"' {
                    in_string = true;
                } else if byte == b'{' {
                    depth += 1;
                } else if byte == b'}' {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        index += 1;
                        return Some(line[start..index].to_string());
                    }
                }

                index += 1;
            }

            None
        }
        b'[' => {
            let mut depth = 0usize;
            let mut in_string = false;
            let mut escaped = false;

            while let Some(byte) = bytes.get(index).copied() {
                if in_string {
                    if escaped {
                        escaped = false;
                    } else if byte == b'\\' {
                        escaped = true;
                    } else if byte == b'"' {
                        in_string = false;
                    }
                } else if byte == b'"' {
                    in_string = true;
                } else if byte == b'[' {
                    depth += 1;
                } else if byte == b']' {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        index += 1;
                        return Some(line[start..index].to_string());
                    }
                }

                index += 1;
            }

            None
        }
        b'"' => parse_json_string(bytes, &mut index),
        _ => {
            while let Some(byte) = bytes.get(index) {
                if matches!(byte, b',' | b'}') {
                    break;
                }
                index += 1;
            }

            Some(line[start..index].trim().to_string())
        }
    }
}

fn session_capabilities_json() -> String {
    format!(
        "{{\"executionPlanVersion\":{EXECUTION_PLAN_VERSION},\"eventGraphVersion\":{EVENT_GRAPH_VERSION},\"parameterGraphVersion\":{PARAMETER_GRAPH_VERSION},\"assets\":false,\"telemetry\":true}}"
    )
}

fn parse_json_object_array(line: &str) -> Vec<String> {
    let mut objects = Vec::new();
    let mut index = 0;
    let bytes = line.as_bytes();

    skip_ws(bytes, &mut index);
    if bytes.get(index) != Some(&b'[') {
        return objects;
    }
    index += 1;

    loop {
        skip_ws(bytes, &mut index);

        if bytes.get(index) == Some(&b']') || index >= bytes.len() {
            break;
        }
        if bytes.get(index) != Some(&b'{') {
            break;
        }

        let start = index;
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;

        while let Some(byte) = bytes.get(index).copied() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == b'"' {
                    in_string = false;
                }
            } else if byte == b'"' {
                in_string = true;
            } else if byte == b'{' {
                depth += 1;
            } else if byte == b'}' {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    index += 1;
                    objects.push(line[start..index].to_string());
                    break;
                }
            }

            index += 1;
        }

        skip_ws(bytes, &mut index);
        match bytes.get(index) {
            Some(b',') => index += 1,
            Some(b']') | None => break,
            _ => break,
        }
    }

    objects
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

fn stable_owner_id(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;

    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }

    hash
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
    fn stopped_transport_snapshot_reports_zero_beat_while_audio_clock_advances() {
        let output = run_session(
            "audio:start driver=null sample_rate=48000 buffer_frames=128 channels=2\n\
             engine:snapshot\n\
             {\"requestId\":2,\"type\":\"engine:command\",\"command\":{\"type\":\"tempo-map:set\",\"originSample\":0,\"originBeat\":0,\"bpm\":120,\"sampleRate\":48000,\"atSample\":0}}\n\
             engine:snapshot\n\
             session:shutdown\n",
        );

        assert!(output.contains("\"samplePosition\":256"));
        assert_eq!(output.matches("\"beatPosition\":0").count(), 2);
    }

    #[test]
    fn null_driver_snapshot_pump_advances_by_elapsed_time() {
        let mut driver = build_session_driver(DriverKind::Null);
        let stream = driver
            .start_output(
                OutputStreamRequest {
                    device_id: None,
                    preferred_sample_rate: Some(48_000),
                    preferred_buffer_frames: Some(128),
                    preferred_channels: Some(2),
                },
                Box::new(EngineProcessor::new(AudioEngine::new())),
            )
            .expect("null driver should start");
        let mut session = Session::new(Vec::new());

        session.driver = Some(driver);
        session.stream = Some(stream);
        session.null_driver_last_pump_at = Some(Instant::now() - Duration::from_millis(40));
        session.process_driver_for_snapshot().unwrap();

        let telemetry = session
            .driver
            .as_ref()
            .and_then(SessionDriver::last_telemetry)
            .expect("null driver should produce telemetry");

        assert!(telemetry.sample_position > 128);
    }

    #[test]
    fn driver_telemetry_merge_preserves_previous_plan_status() {
        let previous = AudioTelemetry {
            sample_position: 128,
            callback_count: 1,
            sample_rate: 48_000,
            callback_frames: 128,
            output_channels: 2,
            runtime_plan_status: engine_protocol::RuntimePlanStatus {
                active_plan_id: Some(42),
                active_plan_revision: Some(7),
                active_plan_maximum_frames: Some(2048),
                pending_plan_count: 1,
                successful_swaps: 2,
                rejected_swaps: 3,
            },
            ..AudioTelemetry::default()
        };
        let driver = AudioTelemetry {
            sample_position: 512,
            callback_count: 4,
            sample_rate: 48_000,
            callback_frames: 128,
            output_channels: 2,
            ..AudioTelemetry::default()
        };

        let merged = merge_driver_telemetry(Some(previous), driver);

        assert_eq!(merged.sample_position, 512);
        assert_eq!(merged.callback_count, 4);
        assert_eq!(merged.runtime_plan_status.active_plan_id, Some(42));
        assert_eq!(merged.runtime_plan_status.active_plan_revision, Some(7));
        assert_eq!(merged.runtime_plan_status.successful_swaps, 2);
    }

    #[test]
    fn plan_swapped_event_updates_cached_snapshot_plan_status() {
        let mut session = Session::new(Vec::new());

        session.last_telemetry = Some(AudioTelemetry {
            sample_position: 512,
            callback_count: 4,
            sample_rate: 48_000,
            callback_frames: 128,
            output_channels: 2,
            ..AudioTelemetry::default()
        });

        session
            .write_engine_event(EngineEvent::ExecutionPlanSwapped {
                command_id: 1,
                plan_id: 2026884842,
                plan_revision: 1671,
                requested_sample: 512,
                applied_sample: 640,
            })
            .unwrap();

        let telemetry = session
            .last_telemetry
            .expect("swap event should update cached telemetry");

        assert_eq!(
            telemetry.runtime_plan_status.active_plan_id,
            Some(2026884842)
        );
        assert_eq!(
            telemetry.runtime_plan_status.active_plan_revision,
            Some(1671)
        );

        let merged = merge_driver_telemetry(
            session.last_telemetry,
            AudioTelemetry {
                sample_position: 1024,
                callback_count: 8,
                sample_rate: 48_000,
                callback_frames: 128,
                output_channels: 2,
                ..AudioTelemetry::default()
            },
        );

        assert_eq!(merged.sample_position, 1024);
        assert_eq!(merged.runtime_plan_status.active_plan_id, Some(2026884842));
        assert_eq!(merged.runtime_plan_status.active_plan_revision, Some(1671));
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

    #[test]
    fn json_engine_commands_accept_scheduler_messages() {
        let output = run_session(
            "{\"requestId\":1,\"type\":\"audio:start\",\"driver\":\"null\",\"sample_rate\":48000,\"buffer_frames\":128,\"channels\":2}\n\
             {\"requestId\":2,\"type\":\"engine:command\",\"command\":{\"type\":\"tempo-map:set\",\"originSample\":0,\"originBeat\":0,\"bpm\":120,\"sampleRate\":48000,\"atSample\":0}}\n\
             {\"requestId\":3,\"type\":\"engine:command\",\"command\":{\"type\":\"transport-loop:set\",\"enabled\":true,\"startSample\":0,\"endSample\":96000,\"atSample\":0}}\n\
             {\"requestId\":4,\"type\":\"engine:command\",\"command\":{\"type\":\"event:schedule-beat\",\"atSample\":0,\"event\":{\"kind\":\"note-on\",\"targetNode\":5,\"note\":60,\"velocity\":0.75,\"atBeat\":1}}}\n\
             {\"requestId\":5,\"type\":\"engine:command\",\"command\":{\"type\":\"event:schedule-beat\",\"atSample\":0,\"event\":{\"kind\":\"note-off\",\"targetNode\":5,\"note\":60,\"atBeat\":1.5}}}\n\
             {\"requestId\":6,\"type\":\"engine:command\",\"command\":{\"type\":\"event:schedule-beat-batch\",\"clipId\":\"clip-1\",\"generation\":2,\"atSample\":0,\"events\":[{\"kind\":\"note-on\",\"targetNode\":5,\"note\":62,\"velocity\":0.8,\"atBeat\":2},{\"kind\":\"note-off\",\"targetNode\":5,\"note\":62,\"atBeat\":2.5}]}}\n\
             {\"requestId\":7,\"type\":\"engine:command\",\"command\":{\"type\":\"event:schedule-sample\",\"event\":{\"kind\":\"note-off\",\"targetNode\":5,\"note\":62,\"atSample\":12000}}}\n\
             {\"requestId\":8,\"type\":\"session:shutdown\"}\n",
        );

        assert!(output.contains("\"requestId\":2,\"type\":\"engine:command\""));
        assert!(output.contains("\"requestId\":3,\"type\":\"engine:command\""));
        assert!(output.contains("\"requestId\":4,\"type\":\"engine:command\""));
        assert!(output.contains("\"requestId\":5,\"type\":\"engine:command\""));
        assert!(output.contains("\"requestId\":6,\"type\":\"engine:command\""));
        assert!(output.contains("\"requestId\":7,\"type\":\"engine:command\""));
        assert!(!output.contains("\"ok\":false"));
    }

    #[test]
    fn batch_note_off_owner_lifetime_defaults_to_generation_bound() {
        let commands = parse_scheduled_beat_event_batch(
            "{\"type\":\"event:schedule-beat-batch\",\"clipId\":\"clip-1\",\"generation\":2,\"atSample\":0,\"events\":[{\"kind\":\"note-off\",\"targetNode\":5,\"note\":62,\"atBeat\":2.5},{\"kind\":\"note-off\",\"targetNode\":5,\"note\":64,\"atBeat\":3.5,\"ownerLifetime\":\"completion-required\"}]}",
            10,
            0,
        )
        .expect("batch should parse");

        assert!(matches!(
            commands[1],
            EngineCommand::ScheduleBeatEvent {
                owner: Some(ScheduledEventOwner {
                    lifetime: ScheduledEventLifetime::GenerationBound,
                    ..
                }),
                ..
            }
        ));
        assert!(matches!(
            commands[2],
            EngineCommand::ScheduleBeatEvent {
                owner: Some(ScheduledEventOwner {
                    lifetime: ScheduledEventLifetime::CompletionRequired,
                    ..
                }),
                ..
            }
        ));
    }

    #[test]
    fn repeated_plan_activation_drains_retired_plans_in_session_mode() {
        let mut input =
            "{\"requestId\":1,\"type\":\"audio:start\",\"driver\":\"null\",\"sample_rate\":48000,\"buffer_frames\":128,\"channels\":2}\n"
                .to_string();

        for index in 0..12 {
            let request_id = 2 + index * 2;
            let plan_id = 100 + index as u64;
            let transfer_id = 1 + index as u64;

            input.push_str(&format!(
                "{{\"requestId\":{request_id},\"type\":\"plan:prepare\",\"plan\":{{\"kind\":\"diagnostic-tone\",\"version\":1,\"planId\":{plan_id},\"planRevision\":1,\"frequencyHz\":440,\"gain\":0.01,\"outputChannels\":2}}}}\n"
            ));
            input.push_str(&format!(
                "{{\"requestId\":{},\"type\":\"plan:activate\",\"transferId\":{transfer_id},\"requestedSample\":0}}\n",
                request_id + 1
            ));
        }

        input.push_str("{\"requestId\":99,\"type\":\"session:shutdown\"}\n");

        let output = run_session(&input);

        assert!(!output.contains("RetirementQueueFull"));
        assert!(!output.contains("PlanActivationFailed"));
        assert_eq!(output.matches("\"type\":\"plan:activated\"").count(), 12);
    }
}
