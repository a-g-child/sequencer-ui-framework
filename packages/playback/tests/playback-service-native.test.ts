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
    assert.equal(start?.atSample, batch?.atSample)
    assert.ok((start?.atSample ?? 0) >= 12_000)
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

    assert.ok(
      backend.commands.some((command) => command.type === 'event:schedule-sample')
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
  private started = false
  private playing = false
  private snapshot: RuntimeSnapshot = {
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

async function waitForNativeServiceTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}
