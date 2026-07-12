import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import WebSocket from 'ws'
import { NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION } from '@sequencer/playback'
import { NativeRuntimeServer } from '../src/server.ts'

describe('NativeRuntimeServer security', () => {
  it('rejects non-loopback host binding', () => {
    assert.throws(
      () =>
        new NativeRuntimeServer({
          host: '0.0.0.0',
          port: 43127,
          token: 'test-token'
        }),
      /loopback only/
    )
  })

  it('rejects disallowed origin', async () => {
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      uiPort: 5173,
      managerFactory: () => new FakeManager()
    })

    const handle = await server.listen()
    const url = `ws://${handle.host}:${handle.port}${handle.wsPath}`

    await assert.rejects(
      () => connectClient(url, 'http://evil.example:5173'),
      /Unexpected server response: 403/
    )

    await server.close()
  })

  it('allows localhost ui origin and enforces handshake token', async () => {
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      token: 'expected-token',
      uiPort: 5173,
      managerFactory: () => new FakeManager()
    })

    const handle = await server.listen()
    const url = `ws://${handle.host}:${handle.port}${handle.wsPath}`

    const socket = await connectClient(url, 'http://localhost:5173')

    socket.send(
      JSON.stringify({
        type: 'handshake',
        protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
        token: 'wrong-token'
      })
    )

    const failure = await readMessage(socket)

    assert.equal(failure.type, 'handshake:error')
    assert.equal(failure.error?.code, 'auth:invalid-token')

    await onceClose(socket)
    await server.close()
  })
})

class FakeManager {
  async start(): Promise<unknown> {
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
  }

  async preparePlan(): Promise<unknown> {
    return { transferId: 1, planId: 1, revision: 1 }
  }

  async activatePlan(): Promise<unknown> {
    return { planId: 1, revision: 1, requestedSample: 0, appliedSample: 0 }
  }

  async sendCommands(): Promise<unknown> {
    return []
  }

  async getSnapshot(): Promise<unknown> {
    return { stream: null, telemetry: null }
  }

  async stopAudio(): Promise<void> {
    return undefined
  }

  async dispose(): Promise<void> {
    return undefined
  }
}

function connectClient(url: string, origin: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin })

    socket.once('open', () => {
      resolve(socket)
    })

    socket.once('error', (error) => {
      reject(error)
    })
  })
}

function readMessage(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.once('message', (payload) => {
      const text =
        typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8')
      resolve(JSON.parse(text))
    })

    socket.once('error', (error) => {
      reject(error)
    })
  })
}

function onceClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('close', () => {
      resolve()
    })
  })
}
