import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PlaybackRuntimeController,
  type RuntimeBackend,
  type RuntimeCompilePlan,
  type RuntimeSnapshot,
  type PreparedRuntimeHandle
} from '../src/native/index.ts'
import type { EngineCommand } from '../src/native/schemas.ts'

describe('PlaybackRuntimeController', () => {
  it('sends transport commands and reconciles observed snapshots', async () => {
    const backend = new FakeRuntimeBackend()
    const controller = new PlaybackRuntimeController(backend, {
      autoPoll: false
    })

    await controller.start()
    assert.equal(controller.status.snapshot?.transport.playing, false)

    await controller.play()
    assert.equal(backend.commands.at(-1)?.type, 'transport:start')
    assert.equal(controller.status.requestedTransportPlaying, true)
    assert.equal(controller.status.snapshot?.transport.playing, true)
    assert.equal(controller.status.commandPending, false)

    await controller.stop()
    assert.equal(backend.commands.at(-1)?.type, 'transport:stop')
    assert.equal(controller.status.snapshot?.transport.playing, false)

    await controller.dispose()
    assert.equal(backend.disposed, true)
  })
})

class FakeRuntimeBackend implements RuntimeBackend {
  commands: EngineCommand[] = []
  disposed = false
  private started = false
  private playing = false
  private samplePosition = 0

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false
    this.playing = false
  }

  async compile(_plan: RuntimeCompilePlan): Promise<PreparedRuntimeHandle> {
    throw new Error('not needed')
  }

  async activate(_handle: PreparedRuntimeHandle): Promise<void> {}

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
    this.samplePosition += this.started ? 128 : 0

    return {
      backend: 'native',
      transport: {
        playing: this.playing,
        samplePosition: this.samplePosition,
        beatPosition: this.samplePosition / 24_000,
        loopIteration: 0
      },
      stream: {
        sampleRate: 48_000,
        callbackCount: Math.floor(this.samplePosition / 128)
      },
      plan: {
        activePlanId: null,
        activeRevision: null,
        pendingTransfers: 0
      },
      diagnostics: {
        xruns: 0,
        queueOverflows: 0
      },
      samplePosition: this.samplePosition,
      sampleRate: 48_000,
      running: this.started
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.started = false
    this.playing = false
  }
}
