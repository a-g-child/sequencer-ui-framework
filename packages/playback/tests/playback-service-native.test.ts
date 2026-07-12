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
})

class FakeRuntimeBackend implements RuntimeBackend {
  compileCalls: RuntimeCompilePlan[] = []
  activateCalls = 0
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
