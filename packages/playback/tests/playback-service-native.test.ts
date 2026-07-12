import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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

  it('activates the next revision for graph updates', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const initialModel = createPlaybackModelFixture()
    const updatedModel = {
      ...initialModel,
      tracks: [
        {
          ...initialModel.tracks[0],
          deviceInstanceIds: ['device-1', 'device-2']
        }
      ]
    }

    service['model'] = initialModel
    service['runtimeBpm'] = 120

    await service['updatePlaybackModel'](updatedModel, { kind: 'graph' })

    const initialCompilation = compilePlaybackModelToNativePlan(initialModel)
    const updatedCompilation = compilePlaybackModelToNativePlan(updatedModel)

    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 1)
    assert.equal(updatedCompilation.plan.revision !== initialCompilation.plan.revision, true)
    assert.equal(controller.status.snapshot?.plan.activeRevision, updatedCompilation.plan.revision)
  })

  it('leaves the previous model and revision active when compile fails', async () => {
    const backend = new FakeRuntimeBackend({ compileError: new Error('compile failed') })
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const initialModel = createPlaybackModelFixture()
    const updatedModel = {
      ...initialModel,
      tracks: [
        {
          ...initialModel.tracks[0],
          deviceInstanceIds: ['device-1', 'device-2']
        }
      ]
    }

    service['model'] = initialModel
    service['runtimeBpm'] = 120

    await assert.rejects(() => service['updatePlaybackModel'](updatedModel, { kind: 'graph' }), /compile failed/)

    assert.equal(service['model'], initialModel)
    assert.equal(service['activeNativeCompilation'], undefined)
    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 0)
  })

  it('keeps the previous model and revision active when activation fails', async () => {
    const backend = new FakeRuntimeBackend({ activateError: new Error('activation failed') })
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const initialModel = createPlaybackModelFixture()
    const updatedModel = {
      ...initialModel,
      tracks: [
        {
          ...initialModel.tracks[0],
          deviceInstanceIds: ['device-1', 'device-2']
        }
      ]
    }

    service['model'] = initialModel
    service['runtimeBpm'] = 120
    service['activeNativeCompilation'] = {
      planId: 'native-plan:project-alpha',
      revision: 1,
      modelKey: 'stale'
    }

    await assert.rejects(() => service['updatePlaybackModel'](updatedModel, { kind: 'graph' }), /activation failed/)

    assert.equal(service['model'], initialModel)
    assert.equal(service['activeNativeCompilation']?.revision, 1)
    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 1)
  })

  it('prevents publication when the snapshot disagrees with the activated revision', async () => {
    const backend = new FakeRuntimeBackend({ activeRevision: 999 })
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const initialModel = createPlaybackModelFixture()
    const updatedModel = {
      ...initialModel,
      tracks: [
        {
          ...initialModel.tracks[0],
          deviceInstanceIds: ['device-1', 'device-2']
        }
      ]
    }

    service['model'] = initialModel
    service['runtimeBpm'] = 120

    await assert.rejects(() => service['updatePlaybackModel'](updatedModel, { kind: 'graph' }), /did not confirm revision/)

    assert.equal(service['model'], initialModel)
    assert.equal(service['activeNativeCompilation'], undefined)
  })

  it('does not recompile on clip-only updates and increments the clip schedule generation', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const initialModel = createPlaybackModelFixture()
    const updatedModel = {
      ...initialModel,
      notes: [
        {
          ...initialModel.notes[0],
          velocity: 0.5
        }
      ]
    }

    service['model'] = initialModel
    service['runtimeBpm'] = 120
    service['latestClockState'] = {
      beat: 0,
      bpm: 120,
      running: true,
      timeMs: 0,
      loop: false,
      loopStartBeat: 0,
      loopLengthBeats: 0
    }

    await controller.start()
    await controller.play()

    await service['updatePlaybackModel'](updatedModel, { kind: 'schedule', clipIds: ['clip-1'] })

    assert.equal(backend.compileCalls.length, 0)
    assert.equal(backend.activateCalls, 0)
    assert.equal(backend.commands.some((command) => command.type === 'event:schedule-beat-batch'), true)

    await service['updatePlaybackModel'](updatedModel, { kind: 'schedule', clipIds: ['clip-1'] })

    const scheduleBatchCommands = backend.commands.filter((command) => command.type === 'event:schedule-beat-batch')
    assert.equal(scheduleBatchCommands.length, 2)
    assert.equal(scheduleBatchCommands[0]?.generation, 1)
    assert.equal(scheduleBatchCommands[1]?.generation, 2)
  })

  it('does not recompile repeated identical model updates', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const model = createPlaybackModelFixture()

    service['model'] = model
    service['runtimeBpm'] = 120

    await service['updatePlaybackModel'](model, { kind: 'graph' })
    await service['updatePlaybackModel'](model, { kind: 'graph' })

    assert.equal(backend.compileCalls.length, 1)
    assert.equal(backend.activateCalls, 1)
  })

  it('does not send another transport-start when a graph update occurs while playing', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })
    const service = new PlaybackService(undefined, controller)

    const initialModel = createPlaybackModelFixture()
    const updatedModel = {
      ...initialModel,
      tracks: [
        {
          ...initialModel.tracks[0],
          deviceInstanceIds: ['device-1', 'device-2']
        }
      ]
    }

    service['model'] = initialModel
    service['runtimeBpm'] = 120

    await controller.start()
    await controller.play()

    const transportStartsBefore = backend.commands.filter((command) => command.type === 'transport:start').length

    await service['updatePlaybackModel'](updatedModel, { kind: 'graph' })

    const transportStartsAfter = backend.commands.filter((command) => command.type === 'transport:start').length

    assert.equal(transportStartsAfter, transportStartsBefore)
  })

  it('keeps the web-audio path working for non-native updates', async () => {
    const service = new PlaybackService(undefined)
    const initialModel = createPlaybackModelFixture()
    const updatedModel = {
      ...initialModel,
      notes: [
        {
          ...initialModel.notes[0],
          velocity: 0.2
        }
      ]
    }

    await service['updatePlaybackModel'](updatedModel, { kind: 'schedule', clipIds: ['clip-1'] })

    assert.equal(service['model'], updatedModel)
  })
})

interface FakeRuntimeBackendOptions {
  readonly compileError?: Error
  readonly activateError?: Error
  readonly activePlanId?: number | null
  readonly activeRevision?: number | null
}

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

  constructor(private readonly options: FakeRuntimeBackendOptions = {}) {}

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
    this.playing = false
  }

  async compile(plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    this.compileCalls.push(plan)

    if (this.options.compileError) {
      throw this.options.compileError
    }

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

    if (this.options.activateError) {
      throw this.options.activateError
    }

    this.snapshot = {
      ...this.snapshot,
      plan: {
        activePlanId: this.options.activePlanId ?? 99,
        activeRevision: this.options.activeRevision ?? (this.compileCalls.at(-1) as { revision: number } | undefined)?.revision ?? 7,
        pendingTransfers: 0
      }
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
