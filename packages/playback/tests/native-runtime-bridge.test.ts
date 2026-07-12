import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createNativeRuntimePreloadApi,
  NativeRuntimeBridgeError,
  RendererNativeRuntimeTransport,
  type NativeRuntimeApi,
  type NativeRuntimeStartOptions
} from '../src/native/NativeRuntimeApi.ts'

describe('Native runtime bridge', () => {
  it('preload API delegates every operation correctly', async () => {
    const calls: Array<[string, unknown]> = []
    const api = createNativeRuntimePreloadApi(async (channel, payload) => {
      calls.push([channel, payload])

      switch (channel) {
        case 'native-runtime:start':
          return { executionPlanVersion: 1, eventGraphVersion: 1, parameterGraphVersion: 0, assets: false, telemetry: true }
        case 'native-runtime:preparePlan':
          return { transferId: 12, planId: 34, revision: 2 }
        case 'native-runtime:activatePlan':
          return { planId: 34, revision: 2, requestedSample: 100, appliedSample: 100 }
        case 'native-runtime:sendCommands':
          return undefined
        case 'native-runtime:getSnapshot':
          return { backend: 'native', transport: { playing: true, samplePosition: 5, beatPosition: 1, loopIteration: 0 }, stream: { sampleRate: 48000, callbackCount: 1 }, plan: { activePlanId: 34, activeRevision: 2, pendingTransfers: 0 }, diagnostics: { xruns: 0, queueOverflows: 0 }, samplePosition: 5, sampleRate: 48000, running: true }
        case 'native-runtime:stopAudio':
          return undefined
        case 'native-runtime:dispose':
          return undefined
        default:
          throw new Error(`unexpected channel ${channel}`)
      }
    })

    const startOptions: NativeRuntimeStartOptions = { driver: 'null' }

    await api.start(startOptions)
    await api.preparePlan({ id: 'plan-1' } as never)
    await api.activatePlan({ transferId: 12, planId: 34, revision: 2 }, 100)
    await api.sendCommands([{ id: 'c1', type: 'transport:start', timeMs: 0, atSample: 0 } as never])
    await api.getSnapshot()
    await api.stopAudio()
    await api.dispose()

    assert.deepEqual(calls.map(([channel]) => channel), [
      'native-runtime:start',
      'native-runtime:preparePlan',
      'native-runtime:activatePlan',
      'native-runtime:sendCommands',
      'native-runtime:getSnapshot',
      'native-runtime:stopAudio',
      'native-runtime:dispose'
    ])
  })

  it('renderer transport surfaces structured failures', async () => {
    const bridgeError = new NativeRuntimeBridgeError('native-runtime:failed', 'bridge failed', { detail: true })
    const api: NativeRuntimeApi = {
      async start() {
        throw bridgeError
      },
      async preparePlan() {
        throw bridgeError
      },
      async activatePlan() {
        throw bridgeError
      },
      async sendCommands() {
        throw bridgeError
      },
      async getSnapshot() {
        throw bridgeError
      },
      async stopAudio() {
        throw bridgeError
      },
      async dispose() {
        throw bridgeError
      }
    }

    const transport = new RendererNativeRuntimeTransport({ api })

    await assert.rejects(() => transport.start(), (error: unknown) => {
      assert.ok(error instanceof NativeRuntimeBridgeError)
      assert.equal(error.code, 'native-runtime:failed')
      return true
    })
  })
})
