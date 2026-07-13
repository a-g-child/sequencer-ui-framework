import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
  type NativeRuntimeSocketFailure,
  type NativeRuntimeSocketHandshakeSuccess,
  type NativeRuntimeSocketSuccess
} from '@sequencer/playback'
import { NativeRuntimeSocketSession } from '../src/NativeRuntimeSocketSession.ts'
import { MAX_PENDING_REQUESTS } from '../src/protocolValidation.ts'

describe('NativeRuntimeSocketSession', () => {
  it('requires handshake before serving requests', async () => {
    const socket = new FakeSocket()
    const manager = createFakeManager()
    const session = new NativeRuntimeSocketSession({
      connectionId: 'c1',
      socket,
      manager,
      token: 'test-token'
    })

    await session.onMessage(
      JSON.stringify({
        type: 'handshake',
        protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
        token: 'test-token'
      })
    )

    const handshake = socket.lastJson() as NativeRuntimeSocketHandshakeSuccess

    assert.equal(handshake.type, 'handshake:ok')

    await session.onMessage(
      JSON.stringify({
        requestId: 1,
        method: 'runtime:start',
        params: { driver: 'null' }
      })
    )

    const response = socket.lastJson() as NativeRuntimeSocketSuccess

    assert.equal(response.requestId, 1)
    assert.equal(response.ok, true)
    assert.equal(manager.startCalls.length, 1)
  })

  it('rejects invalid handshake token', async () => {
    const socket = new FakeSocket()
    const session = new NativeRuntimeSocketSession({
      connectionId: 'c2',
      socket,
      manager: createFakeManager(),
      token: 'expected'
    })

    await session.onMessage(
      JSON.stringify({
        type: 'handshake',
        protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
        token: 'wrong'
      })
    )

    const failure = socket.lastJson() as {
      type: 'handshake:error'
      error: { code: string }
    }

    assert.equal(failure.type, 'handshake:error')
    assert.equal(failure.error.code, 'auth:invalid-token')
    assert.equal(socket.closed, true)
  })

  it('rejects requests when pending request limit is exceeded', async () => {
    const socket = new FakeSocket()
    const session = new NativeRuntimeSocketSession({
      connectionId: 'c3',
      socket,
      manager: createFakeManager(),
      token: 'test-token'
    })

    await session.onMessage(
      JSON.stringify({
        type: 'handshake',
        protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
        token: 'test-token'
      })
    )

    ;(session as unknown as { inFlightRequests: number }).inFlightRequests =
      MAX_PENDING_REQUESTS

    await session.onMessage(
      JSON.stringify({
        requestId: 9,
        method: 'engine:snapshot'
      })
    )

    const failure = socket.lastJson() as NativeRuntimeSocketFailure

    assert.equal(failure.requestId, 9)
    assert.equal(failure.ok, false)
    assert.equal(failure.error.code, 'protocol:too-many-pending-requests')
  })

  it('publishes runtime failed status when a runtime request fails', async () => {
    const socket = new FakeSocket()
    const session = new NativeRuntimeSocketSession({
      connectionId: 'c4',
      socket,
      manager: {
        ...createFakeManager(),
        async getSnapshot() {
          throw Object.assign(new Error('engine child exited'), {
            code: 'runtime:engine-crashed'
          })
        }
      },
      token: 'test-token'
    })

    await session.onMessage(
      JSON.stringify({
        type: 'handshake',
        protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
        token: 'test-token'
      })
    )

    await session.onMessage(
      JSON.stringify({
        requestId: 12,
        method: 'engine:snapshot'
      })
    )

    const status = socket.sentJsonAt(-2) as {
      type: 'runtime:status'
      payload: { state: string; code: string; message: string }
    }
    const failure = socket.lastJson() as NativeRuntimeSocketFailure

    assert.equal(status.type, 'runtime:status')
    assert.equal(status.payload.state, 'failed')
    assert.equal(status.payload.code, 'runtime:engine-crashed')
    assert.equal(status.payload.message, 'engine child exited')
    assert.equal(failure.requestId, 12)
    assert.equal(failure.ok, false)
    assert.equal(failure.error.code, 'runtime:engine-crashed')
  })
})

class FakeSocket {
  private readonly sent: string[] = []
  closed = false

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  lastJson(): unknown {
    return this.sentJsonAt(-1)
  }

  sentJsonAt(index: number): unknown {
    const normalizedIndex = index < 0 ? this.sent.length + index : index
    const value = this.sent[normalizedIndex]

    if (!value) {
      throw new Error('No sent message at index.')
    }

    return JSON.parse(value)
  }

}

function createFakeManager(): FakeManager {
  const manager = {
    startCalls: [] as unknown[],
    async start(options?: unknown) {
      this.startCalls.push(options)
      return {
        protocolVersion: 1,
        capabilities: {
          executionPlanVersion: 1,
          eventGraphVersion: 1,
          parameterGraphVersion: 1,
          assets: false,
          telemetry: true
        },
        drivers: ['null'],
        messages: []
      }
    },
    async listAudioDevices() {
      return []
    },
    async startAudio() {
      return {
        driver: 'null',
        deviceId: 'null',
        deviceName: 'Null',
        sampleRate: 48_000,
        channels: 2,
        sampleFormat: 'f32'
      }
    },
    async stopAudio() {
      return undefined
    },
    async preparePlan() {
      return { transferId: 1, planId: 1, revision: 1 }
    },
    async activatePlan() {
      return { planId: 1, revision: 1, requestedSample: 0, appliedSample: 0 }
    },
    async sendCommands() {
      return []
    },
    async getSnapshot() {
      return {
        stream: null,
        telemetry: null
      }
    },
    async dispose() {
      return undefined
    }
  }

  return manager
}

type FakeManager = {
  startCalls: unknown[]
  start(options?: unknown): Promise<unknown>
  listAudioDevices(): Promise<unknown[]>
  startAudio(): Promise<unknown>
  stopAudio(): Promise<void>
  preparePlan(): Promise<unknown>
  activatePlan(): Promise<unknown>
  sendCommands(): Promise<unknown[]>
  getSnapshot(): Promise<unknown>
  dispose(): Promise<void>
}
