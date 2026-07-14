import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ServiceEventBus, type ServiceEvent } from '@sequencer/core'
import { PlaybackService } from '../src/playback-service.ts'
import { createEmptyPlaybackModel, freezePlaybackModel, type PlaybackModel } from '../src/model.ts'
import { PlaybackRuntimeController } from '../src/native/PlaybackRuntimeController.ts'
import { compilePlaybackModelToNativePlan } from '../src/native/PlaybackModelCompiler.ts'
import type { RuntimeBackend, RuntimeCompilePlan, RuntimeSnapshot, PreparedRuntimeHandle } from '../src/native/RuntimeBackend.ts'
import type { EngineCommand } from '../src/native/schemas.ts'

describe('PlaybackService native startup', () => {
  it('compiles and activates the current model during native startup', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const model = createPlaybackModelFixture()
    service['model'] = model
    service['runtimeBpm'] = 120

    await service['prepareNativeRuntimePlan'](model)

    const compilation = compilePlaybackModelToNativePlan(model)

    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 1)
    assert.equal(controller.status.snapshot?.plan.activePlanId, 99)
    assert.equal(controller.status.snapshot?.plan.activeRevision, compilation.plan.revision)
  })

  it('submits clip schedule and starts native transport from playback start path', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const model = createPlaybackModelFixture()
    service['model'] = model
    service['runtimeBpm'] = 120

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 1)
    assert.deepEqual(
      backend.commands.map((command) => command.type),
      [
        'event-owner:generation:set',
        'tempo-map:set',
        'transport-loop:set',
        'event:schedule-beat-batch',
        'transport:start'
      ]
    )
    assert.equal(controller.status.snapshot?.transport.playing, true)
  })

  it('schedules a clip that was armed before native playback starts', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    assert.deepEqual(
      backend.commands.map((command) => command.type),
      [
        'event-owner:generation:set',
        'tempo-map:set',
        'transport-loop:set',
        'event:schedule-beat-batch',
        'transport:start'
      ]
    )

    const batch = backend.commands.find(
      (command) => command.type === 'event:schedule-beat-batch'
    ) as { events?: readonly unknown[]; atSample?: number } | undefined
    const start = backend.commands.find(
      (command) => command.type === 'transport:start'
    ) as { atSample?: number } | undefined

    assert.ok((batch?.events?.length ?? 0) > 0)
    assert.equal(batch?.atSample, start?.atSample)
    assert.equal(start?.atSample, 12_000)

    const firstNoteOn = batch?.events?.find(
      (event) => (event as { kind?: string }).kind === 'note-on'
    ) as { atBeat?: number } | undefined

    assert.equal(firstNoteOn?.atBeat, 128 / 24_000)
  })

  it('includes the whole first beat in the initial native clip batch', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createFirstBeatPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    const batch = backend.commands.find(
      (command) => command.type === 'event:schedule-beat-batch'
    ) as { events?: readonly { kind?: string; atBeat?: number }[] } | undefined

    assert.deepEqual(
      [...new Set(batch?.events
        ?.filter((event) => event.kind === 'note-on')
        .map((event) => event.atBeat))],
      [128 / 24_000, 0.25, 0.5, 0.75]
    )
  })

  it('includes loop-end note-offs for final-sixteenth notes in the initial native batch', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = freezePlaybackModel({
      ...createPlaybackModelFixture(),
      notes: [
        {
          id: 'final-sixteenth',
          sourceNoteId: 'final-sixteenth',
          trackId: 'track-1',
          clipId: 'clip-1',
          patternId: 'pattern-1',
          pitch: 76,
          velocity: 0.8,
          beat: 3.75,
          duration: 0.25
        }
      ]
    })
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    const batch = backend.commands.find(
      (command) => command.type === 'event:schedule-beat-batch'
    ) as {
      events?: readonly {
        kind?: string
        atBeat?: number
        ownerLifetime?: string
      }[]
    } | undefined

    assert.deepEqual(
      uniqueEventShapes(batch?.events?.map((event) => ({
        kind: event.kind,
        atBeat: event.atBeat,
        ownerLifetime: event.ownerLifetime
      })) ?? []),
      [
        { kind: 'note-on', atBeat: 3.75, ownerLifetime: undefined },
        {
          kind: 'note-off',
          atBeat: 4,
          ownerLifetime: 'completion-required'
        }
      ]
    )
  })

  it('submits one production startup batch for a stopped stream with an armed clip', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createStartupBatchPlaybackModelFixture('clip-1:active')
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')
    await controller.start()

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    const ownerCommands = backend.commands.filter(
      (command) => command.type === 'event-owner:generation:set'
    )
    const tempo = backend.commands.find((command) => command.type === 'tempo-map:set')
    const loop = backend.commands.find((command) => command.type === 'transport-loop:set')
    const batch = backend.commands.find(
      (command) => command.type === 'event:schedule-beat-batch'
    )
    const start = backend.commands.find((command) => command.type === 'transport:start')

    assert.equal(ownerCommands.length, 1)
    assert.equal(tempo?.type, 'tempo-map:set')
    assert.equal(loop?.type, 'transport-loop:set')
    assert.equal(batch?.type, 'event:schedule-beat-batch')
    assert.equal(start?.type, 'transport:start')
    assert.equal(tempo.atSample, batch.atSample)
    assert.equal(loop.atSample, batch.atSample)
    assert.equal(start.atSample, tempo.originSample)
    assert.equal(loop.startSample, tempo.originSample)
    assert.equal(tempo.originBeat, 0)
    assert.equal(ownerCommands[0]?.clipId, batch.clipId)
    assert.equal(batch.generation, ownerCommands[0]?.generation)
    assert.equal(batch.clipId, 'clip-1:active')

    const traceOwner = batch.events[0]?.traceId?.clipOwnerId
    assert.equal(typeof traceOwner, 'number')

    const events = batch.events.map((event) => ({
      kind: event.kind,
      atBeat: event.atBeat,
      note: event.note,
      ownerLifetime: event.ownerLifetime,
      traceRole: event.traceId?.role,
      traceGeneration: event.traceId?.generation,
      traceOwner: event.traceId?.clipOwnerId
    }))

    assert.deepEqual(
      uniqueEventShapes(events),
      [
        {
          kind: 'note-on',
          atBeat: 128 / 24_000,
          note: 60,
          ownerLifetime: undefined,
          traceRole: 'note-on',
          traceGeneration: batch.generation,
          traceOwner
        },
        {
          kind: 'note-off',
          atBeat: 0.25,
          note: 60,
          ownerLifetime: 'completion-required',
          traceRole: 'note-off',
          traceGeneration: batch.generation,
          traceOwner
        },
        {
          kind: 'note-on',
          atBeat: 3.75,
          note: 72,
          ownerLifetime: undefined,
          traceRole: 'note-on',
          traceGeneration: batch.generation,
          traceOwner
        },
        {
          kind: 'note-off',
          atBeat: 4,
          note: 72,
          ownerLifetime: 'completion-required',
          traceRole: 'note-off',
          traceGeneration: batch.generation,
          traceOwner
        }
      ]
    )
  })

  it('queues native transport start without waiting for scheduler telemetry', async () => {
    const backend = new ScheduleApplyRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createFirstBeatPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    assert.equal(backend.snapshotsBetweenBatchAndTransportStart, 0)
    assert.equal(backend.ownerGenerationsSetAtBeatBatch, 0)
  })

  it('resubmits the active clip schedule on a fresh native restart', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })
    await controller.stop()

    backend.commands = []
    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 1_000
    })

    assert.deepEqual(
      backend.commands.map((command) => command.type),
      [
        'event-owner:generation:set',
        'tempo-map:set',
        'transport-loop:set',
        'event:schedule-beat-batch',
        'transport:start'
      ]
    )
  })

  it('uses the requested clock beat as native origin for a fresh start', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    backend.setSnapshot({
      transport: {
        playing: true,
        beatPosition: 12.5,
        samplePosition: 640_000,
        loopIteration: 0
      }
    })
    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    const tempo = backend.commands.find((command) => command.type === 'tempo-map:set')
    const loop = backend.commands.find((command) => command.type === 'transport-loop:set')

    assert.equal(tempo?.type, 'tempo-map:set')
    assert.equal(loop?.type, 'transport-loop:set')
    assert.equal(tempo.originBeat, 0)
    assert.equal(loop.startSample, tempo.originSample)
  })

  it('waits for a pending native stop before scheduling a fresh restart', async () => {
    const backend = new DelayedStopRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false,
      pollIntervalMs: 1
    })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    backend.commands = []
    service['handleServiceEvent']({
      type: 'clock:stopped',
      serviceId: 'clock',
      payload: {
        bpm: 120,
        beat: 0,
        currentStep: 0,
        running: false,
        timeMs: 500
      }
    })
    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 600
    })

    const stopIndex = backend.commands.findIndex(
      (command) => command.type === 'transport:stop'
    )
    const scheduleIndex = backend.commands.findIndex(
      (command) => command.type === 'event:schedule-beat-batch'
    )
    const startIndex = backend.commands.findIndex(
      (command) => command.type === 'transport:start'
    )

    assert.ok(stopIndex >= 0)
    assert.ok(scheduleIndex > stopIndex)
    assert.ok(startIndex > scheduleIndex)
  })

  it('aligns armed clip origins to the native playback start beat', () => {
    const controller = new PlaybackRuntimeController(new FakeRuntimeBackend(), {
      autoPoll: false
    })
    const service = new PlaybackService(undefined, controller)

    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    assert.equal(
      service['liveClips'].state.activeClipByTrackId['track-1']?.launchedAtBeat,
      0
    )

    service['handleServiceEvent']({
      type: 'clock:started',
      serviceId: 'clock',
      payload: {
        bpm: 120,
        beat: 36,
        currentStep: 144,
        running: true,
        timeMs: 10_000
      }
    })

    assert.equal(
      service['liveClips'].state.activeClipByTrackId['track-1']?.launchedAtBeat,
      36
    )
  })

  it('does not clear previous clip voices when applying pending launches at native startup', () => {
    const controller = new PlaybackRuntimeController(new FakeRuntimeBackend(), {
      autoPoll: false
    })
    const service = new PlaybackService(undefined, controller)
    const cleanups: Array<{ trackId: string; reason: string }> = []

    service.requestClipLaunch('track-1', 'clip-1', 'none')
    service['liveClips'].requestLaunch(
      'track-1',
      'clip-2',
      {
        bpm: 120,
        beat: 35.5,
        running: true,
        timeMs: 9_900,
        sourceId: 'test'
      },
      'bar'
    )
    service['panicTrackRuntimeVoices'] = (trackId: string, reason: string) => {
      cleanups.push({ trackId, reason })
    }

    service['handleServiceEvent']({
      type: 'clock:started',
      serviceId: 'clock',
      payload: {
        bpm: 120,
        beat: 36,
        currentStep: 144,
        running: true,
        timeMs: 10_000
      }
    })

    assert.deepEqual(cleanups, [])
    assert.equal(
      service['liveClips'].state.activeClipByTrackId['track-1']?.clipId,
      'clip-2'
    )
    assert.equal(
      service['liveClips'].state.activeClipByTrackId['track-1']?.launchedAtBeat,
      36
    )
  })

  it('does not submit an implicit native schedule during clock-start rebuild', () => {
    const controller = new PlaybackRuntimeController(new FakeRuntimeBackend(), {
      autoPoll: false
    })
    const service = new PlaybackService(undefined, controller)
    const rebuildOptions: unknown[] = []

    service['rebuildModel'] = (options = {}) => {
      rebuildOptions.push(options)
    }
    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    service['handleServiceEvent']({
      type: 'clock:started',
      serviceId: 'clock',
      payload: {
        bpm: 120,
        beat: 0,
        currentStep: 0,
        running: true,
        timeMs: 0
      }
    })

    assert.deepEqual(rebuildOptions.at(-1), {
      prepareNativeRuntimePlan: false,
      submitNativeClipSchedule: false
    })
  })

  it('quantizes native clip launches from the observed runtime beat', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    backend.setSnapshot({
      transport: {
        playing: true,
        beatPosition: 26.75,
        samplePosition: 640_000,
        loopIteration: 0
      }
    })
    service['runtimeBpm'] = 120
    service['latestClockState'] = {
      bpm: 120,
      beat: 24,
      running: true,
      sourceId: 'stale-clock',
      timeMs: 12_000
    }
    await controller.start()

    service.requestClipLaunch('track-1', 'clip-1', 'bar')

    assert.equal(
      service.status.liveClips.pendingLaunchByTrackId['track-1']?.launchAtBeat,
      28
    )
  })

  it('submits the active clip schedule instead of the first model clip', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createTwoClipPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-b', 'bar')

    assert.equal(service['nativeScheduleClip']()?.id, 'clip-b:active')
  })

  it('updates native tempo without recompiling the execution plan', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    backend.commands = []
    service['handleServiceEvent']({
      type: 'clock:tempo-changed',
      serviceId: 'clock',
      payload: {
        bpm: 135,
        beat: 2,
        currentStep: 8,
        running: true,
        timeMs: 1_000
      }
    })
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 1)
    assert.deepEqual(
      backend.commands.map((command) => command.type),
      ['tempo-map:set']
    )
    assert.equal(
      (backend.commands[0] as { bpm?: number } | undefined)?.bpm,
      135
    )
  })

  it('uses the current native sample origin for scheduled loop bounds', async () => {
    const backend = new AdvancingSnapshotRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const model = createPlaybackModelFixture()
    service['model'] = model
    service['runtimeBpm'] = 120

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    const tempo = backend.commands.find((command) => command.type === 'tempo-map:set')
    const loop = backend.commands.find((command) => command.type === 'transport-loop:set')

    assert.equal(tempo?.type, 'tempo-map:set')
    assert.equal(loop?.type, 'transport-loop:set')
    assert.equal(loop?.startSample, tempo?.originSample)
    assert.equal(loop?.endSample, (tempo?.originSample ?? 0) + 96_000)
  })

  it('does not reactivate the native graph when playback only adds a clip schedule', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const graphOnlyModel = createPlaybackGraphFixture()
    const clipModel = createPlaybackModelFixture()
    service['model'] = graphOnlyModel
    service['runtimeBpm'] = 120

    await service['prepareNativeRuntimePlan'](graphOnlyModel)

    service['model'] = clipModel
    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 1)
    assert.deepEqual(
      backend.commands.map((command) => command.type),
      [
        'event-owner:generation:set',
        'tempo-map:set',
        'transport-loop:set',
        'event:schedule-beat-batch',
        'transport:start'
      ]
    )
  })

  it('does not send an empty native clip schedule batch', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const model = createEmptyClipPlaybackModelFixture()
    service['model'] = model
    service['runtimeBpm'] = 120

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    assert.deepEqual(
      backend.commands.map((command) => command.type),
      [
        'event-owner:generation:set',
        'tempo-map:set',
        'transport-loop:set',
        'transport:start'
      ]
    )
  })

  it('invalidates the previous native clip owner when the active clip clears during playback', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    backend.commands = []
    service['model'] = createPlaybackGraphFixture()
    service['latestClockState'] = {
      bpm: 120,
      beat: 2,
      currentStep: 8,
      running: true,
      timeMs: 1_000
    }

    service['submitNativeClipScheduleReplacement']()
    await Promise.resolve()
    await Promise.resolve()

    assert.deepEqual(
      backend.commands.map((command) => command.type),
      ['event-owner:generation:set']
    )
    assert.equal(backend.commands[0]?.type, 'event-owner:generation:set')
    assert.equal(
      (backend.commands[0] as { clipId?: string } | undefined)?.clipId,
      'clip-1'
    )
  })

  it('sends one-shot native note-offs when stopping an active clip during playback', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    backend.commands = []
    service['latestClockState'] = {
      bpm: 120,
      beat: 0.25,
      currentStep: 1,
      running: true,
      timeMs: 125
    }

    service.clearActiveClipForTrack('track-1')
    await Promise.resolve()
    await Promise.resolve()

    assert.deepEqual(
      backend.commands
        .filter((command) => command.type === 'event:schedule-sample')
        .map((command) => command.event.note),
      [69]
    )
    assert.ok(
      backend.commands
        .filter((command) => command.type === 'event:schedule-sample')
        .every((command) => command.event.atSample >= 12_000)
    )
  })

  it('sends note-offs when disabling a document clip backed by an active playback clip id', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createActivePlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    backend.commands = []
    service['latestClockState'] = {
      bpm: 120,
      beat: 0.25,
      currentStep: 1,
      running: true,
      timeMs: 125
    }

    service.clearActiveClipForTrack('track-1')
    await waitForNativeServiceTasks()

    assert.deepEqual(
      backend.commands
        .filter((command) => command.type === 'event:schedule-sample')
        .map((command) => command.event.note),
      [69]
    )
  })

  it('pre-schedules quantized native clip launches at the launch beat', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    backend.setSnapshot({
      transport: {
        playing: true,
        beatPosition: 3.25,
        samplePosition: 78_000,
        loopIteration: 0
      }
    })
    service['runtimeBpm'] = 120
    service['context'] = {
      documentStore: { document: {} },
      events: { emit() {}, subscribe: () => () => {} }
    } as never
    service['builder'].build = (_document, bpm, options) =>
      createActivePlaybackModelFixture(
        options.activeClipsByTrackId?.['track-1']?.launchedAtBeat ?? 0,
        bpm
      )
    service['rebuildModel'] = () => {}
    await controller.start()

    service.requestClipLaunch('track-1', 'clip-1', 'bar')
    await waitForNativeServiceTasks()

    const tempo = backend.commands.find((command) => command.type === 'tempo-map:set')
    const loop = backend.commands.find((command) => command.type === 'transport-loop:set')
    const batch = backend.commands.find(
      (command) => command.type === 'event:schedule-beat-batch'
    )

    assert.equal(tempo?.type, 'tempo-map:set')
    assert.equal(loop?.type, 'transport-loop:set')
    assert.equal(batch?.type, 'event:schedule-beat-batch')
    assert.equal(tempo.originBeat, 4)
    assert.equal(loop.startSample, tempo.originSample)
    assert.deepEqual(
      batch.events
        .filter((event) => event.kind === 'note-on')
        .map((event) => event.atBeat),
      [4]
    )

    backend.commands = []
    service['handleServiceEvent']({
      type: 'clock:tick',
      serviceId: 'clock',
      payload: {
        bpm: 120,
        beat: 4,
        currentStep: 16,
        running: true,
        timeMs: 500
      }
    })

    assert.deepEqual(backend.commands, [])
  })

  it('schedules immediate native clip re-cues from one activation beat/sample pair', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    backend.setSnapshot({
      transport: {
        playing: true,
        beatPosition: 2.375,
        samplePosition: 114_000,
        loopIteration: 0
      }
    })
    service['runtimeBpm'] = 120
    service['context'] = {
      documentStore: { document: {} },
      events: { emit() {}, subscribe: () => () => {} }
    } as never
    service['builder'].build = (_document, bpm, options) =>
      createActivePlaybackModelFixture(
        options.activeClipsByTrackId?.['track-1']?.launchedAtBeat ?? 0,
        bpm
      )
    service['rebuildModel'] = () => {}
    await controller.start()

    service.requestClipLaunch('track-1', 'clip-1', 'none')
    await waitForNativeServiceTasks()

    const tempo = backend.commands.find((command) => command.type === 'tempo-map:set')
    const loop = backend.commands.find((command) => command.type === 'transport-loop:set')
    const batch = backend.commands.find(
      (command) => command.type === 'event:schedule-beat-batch'
    )

    assert.equal(tempo?.type, 'tempo-map:set')
    assert.equal(loop?.type, 'transport-loop:set')
    assert.equal(batch?.type, 'event:schedule-beat-batch')
    assert.equal(tempo.originBeat, 2.875)
    assert.equal(loop.startSample, tempo.originSample)
    assert.deepEqual(
      batch.events
        .filter((event) => event.kind === 'note-on')
        .map((event) => event.atBeat),
      [2.875]
    )
  })

  it('releases the submitted native notes when a live edit is deferred before clip stop', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    backend.commands = []
    service['latestClockState'] = {
      bpm: 120,
      beat: 0.25,
      currentStep: 1,
      running: true,
      timeMs: 125
    }
    service['rebuildModel'] = () => {
      service['model'] = createEditedPlaybackModelFixture()
    }

    service['handlePlaybackModelOperation']()
    service.clearActiveClipForTrack('track-1')
    await waitForNativeServiceTasks()

    assert.deepEqual(
      backend.commands
        .filter((command) => command.type === 'event:schedule-sample')
        .map((command) => command.event.note),
      [69]
    )
  })

  it('defers native clip schedule replacement for live document edits during playback', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    service['model'] = createPlaybackModelFixture()
    service['runtimeBpm'] = 120
    service.requestClipLaunch('track-1', 'clip-1', 'none')

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    backend.commands = []
    service['latestClockState'] = {
      bpm: 120,
      beat: 0.25,
      currentStep: 1,
      running: true,
      timeMs: 125
    }
    service['rebuildModel'] = () => {
      service['model'] = createPlaybackGraphFixture()
    }

    service['handlePlaybackModelOperation']()
    await waitForNativeServiceTasks()

    assert.deepEqual(
      backend.commands.map((command) => command.type),
      []
    )
    assert.equal(controller.status.failure, undefined)
  })

  it('does not panic native transport for schedule-only MIDI edits', () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)
    let rebuilt = false

    service['rebuildModel'] = () => {
      rebuilt = true
    }

    service.onCommandExecuted({ name: 'Create Note' } as never)

    assert.equal(rebuilt, true)
    assert.equal(
      backend.commands.some((command) => command.type === 'panic'),
      false
    )
  })

  it('applies queued native clip launches on clock ticks', () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)
    let rebuilt = false

    service['rebuildModel'] = () => {
      rebuilt = true
    }
    service['latestClockState'] = {
      bpm: 120,
      beat: 0.25,
      currentStep: 1,
      running: true,
      timeMs: 125
    }
    service.requestClipLaunch('track-1', 'clip-1', 1)
    rebuilt = false

    service['handleServiceEvent']({
      type: 'clock:tick',
      serviceId: 'clock',
      payload: {
        bpm: 120,
        beat: 1,
        currentStep: 4,
        running: true,
        timeMs: 500
      }
    })

    assert.equal(rebuilt, true)
    assert.equal(
      service.status.liveClips.activeClipByTrackId['track-1']?.clipId,
      'clip-1'
    )
    assert.equal(
      service.status.liveClips.pendingLaunchByTrackId['track-1'],
      undefined
    )
  })

  it('uses a fresh native snapshot sample for clip scheduling', async () => {
    const backend = new AdvancingSnapshotRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const model = createPlaybackModelFixture()
    service['model'] = model
    service['runtimeBpm'] = 120

    await service['prepareAndStartNativeRuntime']({
      bpm: 120,
      beat: 0,
      currentStep: 0,
      running: true,
      timeMs: 0
    })

    const scheduleCommands = backend.commands.filter(
      (command) =>
        command.type === 'tempo-map:set' ||
        command.type === 'transport-loop:set' ||
        command.type === 'event:schedule-beat-batch'
    )

    assert.ok(scheduleCommands.length > 0)
    assert.ok(scheduleCommands.every((command) => command.atSample >= 256))
  })

  it('keeps native plan revisions stable across schedule-only model changes', () => {
    const graphOnlyCompilation = compilePlaybackModelToNativePlan(
      createPlaybackGraphFixture()
    )
    const clipCompilation = compilePlaybackModelToNativePlan(
      createPlaybackModelFixture()
    )

    assert.equal(
      graphOnlyCompilation.plan.revision,
      clipCompilation.plan.revision
    )
  })

  it('fails native startup visibly when the project is unsupported', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const model = freezePlaybackModel({
      ...createPlaybackModelFixture(),
      automations: [
        {
          id: 'automation-1',
          sourceEventId: 'automation-1',
          trackId: 'track-1',
          clipId: 'clip-1',
          patternId: 'pattern-1',
          parameterId: 'gain',
          value: 0.5,
          beat: 0
        }
      ]
    })

    await assert.rejects(
      () => service['prepareNativeRuntimePlan'](model),
      /Automation lanes are not supported/
    )

    assert.equal(backend.compileCalls.length, 0)
    assert.equal(controller.status.state, 'failed')
    assert.match(controller.status.failure ?? '', /Automation lanes are not supported/)
  })

  it('requests clock stop when native startup fails after play was requested', () => {
    const controller = new PlaybackRuntimeController(new FakeRuntimeBackend(), {
      autoPoll: false
    })
    const service = new PlaybackService(undefined, controller)
    const events = new ServiceEventBus()
    const emitted: ServiceEvent[] = []

    events.subscribe((event) => {
      emitted.push(event)
    })

    service['context'] = {
      events
    } as never

    service['stopClockAfterNativeStartFailure']()

    assert.deepEqual(
      emitted.map((event) => event.type),
      ['transport:playing-changed', 'transport:beat-changed']
    )
    assert.deepEqual(emitted[0]?.payload, { playing: false })
    assert.deepEqual(emitted[1]?.payload, { currentBeat: 0, currentStep: 0 })
  })
})

class FakeRuntimeBackend implements RuntimeBackend {
  compileCalls: RuntimeCompilePlan[] = []
  activateCalls = 0
  commands: EngineCommand[] = []
  protected started = false
  protected playing = false
  protected snapshot: RuntimeSnapshot = {
    backend: 'native',
    transport: { playing: false, samplePosition: 0, beatPosition: 0, loopIteration: 0 },
    stream: { sampleRate: 48_000, callbackCount: 0 },
    plan: { activePlanId: null, activeRevision: null, pendingTransfers: 0 },
    diagnostics: { xruns: 0, queueOverflows: 0 },
    samplePosition: 0,
    sampleRate: 48_000,
    running: false
  }

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
    this.playing = false
  }

  async compile(plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    this.compileCalls.push(plan)

    return {
      id: 'native-handle',
      planId: String((plan as { id: string }).id),
      backend: 'native',
      transferId: 1,
      revision: (plan as { revision: number }).revision,
      ownerId: 'fake'
    }
  }

  async activate(_handle: PreparedRuntimeHandle): Promise<void> {
    this.activateCalls += 1
    this.snapshot = {
      ...this.snapshot,
      plan: { activePlanId: 99, activeRevision: (this.compileCalls.at(-1) as { revision: number } | undefined)?.revision ?? 7, pendingTransfers: 0 }
    }
  }

  setSnapshot(patch: {
    readonly transport?: Partial<RuntimeSnapshot['transport']>
  }): void {
    this.snapshot = {
      ...this.snapshot,
      transport: {
        ...this.snapshot.transport,
        ...patch.transport
      }
    }
    this.playing = this.snapshot.transport.playing
  }

  sendCommands(commands: readonly EngineCommand[]): void {
    for (const command of commands) {
      this.commands.push(command)

      if (command.type === 'transport:start') {
        this.playing = true
      } else if (command.type === 'transport:stop' || command.type === 'panic') {
        this.playing = false
      }
    }
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return {
      ...this.snapshot,
      transport: { ...this.snapshot.transport, playing: this.playing },
      running: this.started
    }
  }

  async dispose(): Promise<void> {}
}

class ScheduleApplyRuntimeBackend extends FakeRuntimeBackend {
  beatEventsInsertedAtTransportStart = 0
  ownerGenerationsSetAtBeatBatch = 0
  snapshotsBetweenBatchAndTransportStart = 0
  private pendingBeatEvents = 0
  private pendingOwnerGenerations = 0
  private batchQueued = false
  private transportStartQueued = false

  constructor() {
    super()
    this.snapshot = {
      ...this.snapshot,
      diagnostics: {
        ...this.snapshot.diagnostics,
        scheduler: createSchedulerDiagnostics()
      }
    }
  }

  sendCommands(commands: readonly EngineCommand[]): void {
    for (const command of commands) {
      if (command.type === 'event-owner:generation:set') {
        this.pendingOwnerGenerations += 1
      }

      if (command.type === 'event:schedule-beat-batch') {
        this.ownerGenerationsSetAtBeatBatch =
          this.snapshot.diagnostics.scheduler?.ownerGenerationsSet ?? 0
        this.pendingBeatEvents += command.events.length
        this.batchQueued = true
      }

      if (command.type === 'transport:start') {
        this.beatEventsInsertedAtTransportStart =
          this.snapshot.diagnostics.scheduler?.beatEventsInserted ?? 0
        this.transportStartQueued = true
      }
    }

    super.sendCommands(commands)
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    if (this.batchQueued && !this.transportStartQueued) {
      this.snapshotsBetweenBatchAndTransportStart += 1
    }

    if (this.pendingOwnerGenerations > 0 || this.pendingBeatEvents > 0) {
      const scheduler = this.snapshot.diagnostics.scheduler ?? createSchedulerDiagnostics()

      this.snapshot = {
        ...this.snapshot,
        diagnostics: {
          ...this.snapshot.diagnostics,
          scheduler: {
            ...scheduler,
            ownerGenerationsSet:
              scheduler.ownerGenerationsSet + this.pendingOwnerGenerations,
            beatEventsInserted: scheduler.beatEventsInserted + this.pendingBeatEvents
          }
        }
      }
      this.pendingOwnerGenerations = 0
      this.pendingBeatEvents = 0
    }

    return super.getSnapshot()
  }
}

class DelayedStopRuntimeBackend extends FakeRuntimeBackend {
  private stopPending = false
  private stopSnapshots = 0

  sendCommands(commands: readonly EngineCommand[]): void {
    for (const command of commands) {
      if (command.type === 'transport:stop') {
        this.commands.push(command)
        this.stopPending = true
        this.stopSnapshots = 0
        continue
      }

      super.sendCommands([command])
    }
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    if (this.stopPending) {
      this.stopSnapshots += 1

      if (this.stopSnapshots >= 2) {
        this.playing = false
        this.stopPending = false
      }
    }

    return super.getSnapshot()
  }
}

class AdvancingSnapshotRuntimeBackend extends FakeRuntimeBackend {
  private samplePosition = 0

  async getSnapshot(): Promise<RuntimeSnapshot> {
    this.samplePosition += 128
    const snapshot = await super.getSnapshot()

    return {
      ...snapshot,
      samplePosition: this.samplePosition,
      transport: {
        ...snapshot.transport,
        samplePosition: this.samplePosition
      },
      stream: {
        ...snapshot.stream,
        callbackCount: Math.floor(this.samplePosition / 128)
      }
    }
  }
}

function createPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    ...createEmptyPlaybackModel(120),
    id: 'project-alpha',
    tracks: [
      {
        id: 'track-1',
        name: 'Lead',
        channel: 1,
        mixer: { volume: 1, pan: 0 },
        deviceInstanceIds: ['device-1']
      }
    ],
    clips: [
      {
        id: 'clip-1',
        trackId: 'track-1',
        patternId: 'pattern-1',
        name: 'Main',
        start: 0,
        length: 4,
        loop: true,
        loopStart: 0,
        loopLength: 4,
        sourceStart: 0,
        sourceLength: 4,
        loopIndex: 0
      }
    ],
    notes: [
      {
        id: 'note-1',
        sourceNoteId: 'note-1',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        pitch: 69,
        velocity: 0.8,
        beat: 0,
        duration: 1
      }
    ]
  })
}

function createSchedulerDiagnostics(
  beatEventsInserted = 0
): NonNullable<RuntimeSnapshot['diagnostics']['scheduler']> {
  return {
    ownerGenerationsSet: 0,
    sampleEventsInserted: 0,
    beatEventsInserted,
    beatEventMinSample: null,
    beatEventMaxSample: null,
    firstScheduledEventVisitedSample: null,
    firstScheduledEventDispatchedSample: null,
    eventsDroppedCapacity: 0,
    eventsDroppedNotPlaying: 0,
    eventsSuppressedWhileStopped: 0,
    eventsDiscardedOwner: 0,
    eventsDiscardedFutureOwner: 0,
    noteOnsDispatched: 0,
    noteOffsDispatched: 0,
    loopReschedules: 0,
    loopRescheduleSkippedDisabled: 0,
    loopRescheduleSkippedOutside: 0,
    eventsCleared: 0,
    transportLoopEnabled: false,
    transportLoopStartSample: 0,
    transportLoopEndSample: 0
  }
}

function createFirstBeatPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    ...createPlaybackModelFixture(),
    notes: [0, 0.25, 0.5, 0.75].map((beat, index) => ({
      id: `note-${index + 1}`,
      sourceNoteId: `note-${index + 1}`,
      trackId: 'track-1',
      clipId: 'clip-1',
      patternId: 'pattern-1',
      pitch: 60 + index,
      velocity: 0.8,
      beat,
      duration: 0.125
    }))
  })
}

function createStartupBatchPlaybackModelFixture(clipId = 'clip-1'): PlaybackModel {
  return freezePlaybackModel({
    ...createPlaybackModelFixture(),
    clips: [
      {
        id: clipId,
        trackId: 'track-1',
        patternId: 'pattern-1',
        name: 'Main',
        start: 0,
        length: 4,
        loop: true,
        loopStart: 0,
        loopLength: 4,
        sourceStart: 0,
        sourceLength: 4,
        loopIndex: 0
      }
    ],
    notes: [
      {
        id: 'beat-zero',
        sourceNoteId: 'beat-zero',
        trackId: 'track-1',
        clipId,
        patternId: 'pattern-1',
        pitch: 60,
        velocity: 0.8,
        beat: 0,
        duration: 0.25
      },
      {
        id: 'final-sixteenth',
        sourceNoteId: 'final-sixteenth',
        trackId: 'track-1',
        clipId,
        patternId: 'pattern-1',
        pitch: 72,
        velocity: 0.8,
        beat: 3.75,
        duration: 0.25
      }
    ]
  })
}

function createPlaybackGraphFixture(): PlaybackModel {
  return freezePlaybackModel({
    ...createEmptyPlaybackModel(120),
    id: 'project-alpha',
    tracks: [
      {
        id: 'track-1',
        name: 'Lead',
        channel: 1,
        mixer: { volume: 1, pan: 0 },
        deviceInstanceIds: ['device-1']
      }
    ]
  })
}

function createActivePlaybackModelFixture(start = 0, bpm = 120): PlaybackModel {
  return freezePlaybackModel({
    ...createPlaybackModelFixture(),
    tempoMap: {
      defaultBpm: bpm,
      changes: [{ beat: 0, bpm }]
    },
    clips: [
      {
        id: 'clip-1:active',
        trackId: 'track-1',
        patternId: 'pattern-1',
        name: 'Main',
        start,
        length: 4,
        loop: true,
        loopStart: 0,
        loopLength: 4,
        sourceStart: 0,
        sourceLength: 4,
        loopIndex: 0
      }
    ],
    notes: [
      {
        id: 'clip-1:active:note-1',
        sourceNoteId: 'note-1',
        trackId: 'track-1',
        clipId: 'clip-1:active',
        patternId: 'pattern-1',
        pitch: 69,
        velocity: 0.8,
        beat: start,
        duration: 1
      }
    ]
  })
}

function createTwoClipPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    ...createPlaybackModelFixture(),
    clips: [
      {
        id: 'clip-a:active',
        trackId: 'track-1',
        patternId: 'pattern-a',
        name: 'A',
        start: 0,
        length: 4,
        loop: true,
        loopStart: 0,
        loopLength: 4,
        sourceStart: 0,
        sourceLength: 4,
        loopIndex: 0
      },
      {
        id: 'clip-b:active',
        trackId: 'track-1',
        patternId: 'pattern-b',
        name: 'B',
        start: 0,
        length: 4,
        loop: true,
        loopStart: 0,
        loopLength: 4,
        sourceStart: 0,
        sourceLength: 4,
        loopIndex: 0
      }
    ],
    notes: [
      {
        id: 'clip-a:active:note-1',
        sourceNoteId: 'note-a',
        trackId: 'track-1',
        clipId: 'clip-a:active',
        patternId: 'pattern-a',
        pitch: 60,
        velocity: 0.8,
        beat: 0,
        duration: 1
      },
      {
        id: 'clip-b:active:note-1',
        sourceNoteId: 'note-b',
        trackId: 'track-1',
        clipId: 'clip-b:active',
        patternId: 'pattern-b',
        pitch: 72,
        velocity: 0.8,
        beat: 0,
        duration: 1
      }
    ]
  })
}

function createEmptyClipPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    ...createPlaybackModelFixture(),
    notes: []
  })
}

function createEditedPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    ...createPlaybackModelFixture(),
    notes: [
      {
        id: 'note-1',
        sourceNoteId: 'note-1',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        pitch: 72,
        velocity: 0.8,
        beat: 0,
        duration: 1
      }
    ]
  })
}

function uniqueEventShapes<T>(events: readonly T[]): T[] {
  return [...new Map(events.map((event) => [JSON.stringify(event), event])).values()]
}

async function waitForNativeServiceTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}
