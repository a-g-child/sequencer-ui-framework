import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { NativeExecutionPlan } from '@sequencer/audio-graph'
import {
  createRuntimeBackend,
  createDiagnosticNativeExecutionPlan,
  NativeBackend,
  WebAudioBackend,
  type RuntimeBackend
} from '../src/native/RuntimeBackend.ts'
import { NativeSessionClient } from '../src/native/NativeSessionClient.ts'

const nativeEngineCwd = new URL('../../../native-audio-engine/', import.meta.url)
  .pathname

function createPlan(id = 'plan-1'): NativeExecutionPlan {
  return {
    id,
    graphId: 'graph-1',
    nodes: [],
    buffers: [],
    parameters: [],
    eventRoutes: [],
    executionGroups: [],
    latencySamples: 0
  }
}

function createNativeBackend(): NativeBackend {
  return new NativeBackend({
    client: new NativeSessionClient({
      command: process.env.CARGO ?? '/Users/andrew/.cargo/bin/cargo',
      args: ['run', '-p', 'engine-host', '--', '--session-stdio'],
      cwd: nativeEngineCwd,
      shutdownTimeoutMs: 2_000
    }),
    audio: {
      driver: 'null',
      sampleRate: 48_000,
      bufferFrames: 128,
      channels: 2
    }
  })
}

describe('RuntimeBackend', () => {
  it('creates the selected runtime backend from factory options', async () => {
    const output = new FakeWebAudioOutput()
    const webBackend = createRuntimeBackend({
      kind: 'web-audio',
      webAudioOutput: output
    })
    const nativeBackend = createRuntimeBackend({
      kind: 'native',
      native: {
        client: new NativeSessionClient({
          command: 'cargo',
          args: ['--version']
        })
      }
    })

    assert.ok(webBackend instanceof WebAudioBackend)
    assert.ok(nativeBackend instanceof NativeBackend)

    await webBackend.start()
    assert.equal(output.connected, true)
    await webBackend.dispose()
  })

  it('lets WebAudio compile and activate a backend-neutral handle', async () => {
    const output = new FakeWebAudioOutput()
    const backend: RuntimeBackend = new WebAudioBackend(output)
    const handle = await backend.compile(createPlan('plan-web'))

    assert.equal(handle.planId, 'plan-web')

    await backend.activate(handle)
    await backend.start()

    const snapshot = await backend.getSnapshot()

    assert.equal(snapshot.backend, 'web-audio')
    assert.equal(snapshot.running, true)

    await backend.stop()
    await backend.dispose()
    assert.equal(output.connected, false)
  })

  it('starts native audio and exposes authoritative native snapshots', async () => {
    const backend = createNativeBackend()

    try {
      await backend.start()

      const handle = await backend.compile(
        createDiagnosticNativeExecutionPlan({
          planId: 42,
          planRevision: 7,
          frequencyHz: 330,
          gain: 0.02
        })
      )

      assert.equal(handle.backend, 'native')
      assert.equal(handle.planId, '42')
      assert.equal(handle.revision, 7)
      assert.ok(handle.transferId > 0)

      await backend.activate(handle)
      await assert.rejects(() => backend.activate(handle), /already been consumed/)

      const snapshot = await backend.getSnapshot()

      assert.equal(snapshot.backend, 'native')
      assert.equal(snapshot.running, true)
      assert.equal(snapshot.transport.playing, false)
      assert.ok(snapshot.samplePosition > 0)
      assert.equal(backend.negotiatedCapabilities?.executionPlanVersion, 1)
      assert.equal(snapshot.native?.telemetry?.plan?.activePlanId, 42)
      assert.equal(snapshot.native?.telemetry?.plan?.activeRevision, 7)

      backend.sendCommands([
        {
          id: 'start-native-transport',
          type: 'transport:start',
          timeMs: 0,
          atSample: 0
        }
      ])

      await new Promise((resolve) => setTimeout(resolve, 25))

      const playingSnapshot = await backend.getSnapshot()

      assert.equal(playingSnapshot.transport.playing, true)

      await assert.rejects(() => backend.compile(createPlan('native-plan')), /wire plans/)

      await backend.stop()
    } finally {
      await backend.dispose()
    }
  })
})

class FakeWebAudioOutput {
  readonly id = 'fake-web-audio'
  readonly name = 'Fake Web Audio'
  connected = false
  panicked = false

  async connect(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  handleEvents(): void {}

  panic(): void {
    this.panicked = true
  }
}
