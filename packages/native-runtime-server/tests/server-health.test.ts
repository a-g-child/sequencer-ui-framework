import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import WebSocket from 'ws'
import { NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION } from '@sequencer/playback'
import { NativeRuntimeServer } from '../src/server.ts'

describe('NativeRuntimeServer health', () => {
  it('reports idle runtime health without requiring a UI directory', async () => {
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0
    })

    const handle = await server.listen()
    const response = await fetch(`http://${handle.host}:${handle.port}/health`)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.deepEqual(body, {
      ok: true,
      protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
      runtimeOwned: false,
      engineRunning: false
    })

    await server.close()
  })

  it('reports ownership once a browser client starts the runtime', async () => {
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      managerFactory: () => new FakeManager()
    })

    const handle = await server.listen()
    const url = `ws://${handle.host}:${handle.port}${handle.wsPath}`
    const origin = `http://${handle.host}:${handle.port}`
    const socket = await connectClient(url, origin)

    await performHandshake(socket, 'test-token')
    const startResponse = await sendRequest(socket, {
      requestId: 1,
      method: 'runtime:start',
      params: { driver: 'null' }
    })

    assert.equal(startResponse.ok, true)

    const response = await fetch(`http://${handle.host}:${handle.port}/health`)
    const body = await response.json()

    assert.equal(body.runtimeOwned, true)
    assert.equal(body.engineRunning, true)

    socket.close()
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

  async startAudio(): Promise<unknown> {
    return {
      driver: 'null',
      deviceId: 'null',
      deviceName: 'Null',
      sampleRate: 48_000,
      channels: 2,
      sampleFormat: 'f32'
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

  async stopAudio(): Promise<void> {}

  async dispose(): Promise<void> {}
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

async function performHandshake(socket: WebSocket, token: string): Promise<void> {
  socket.send(
    JSON.stringify({
      type: 'handshake',
      protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
      token
    })
  )

  const message = await readMessage(socket)

  assert.equal(message.type, 'handshake:ok')
}

async function sendRequest(
  socket: WebSocket,
  request: {
    requestId: number
    method: string
    params?: unknown
  }
): Promise<{
  requestId: number
  ok: boolean
  result?: unknown
  error?: { code?: string; message?: string }
}> {
  socket.send(JSON.stringify(request))
  return readMessage(socket)
}

function readMessage(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.once('message', (payload) => {
      const text =
        typeof payload === 'string'
          ? payload
          : Buffer.from(payload as Buffer).toString('utf8')

      resolve(JSON.parse(text))
    })

    socket.once('error', (error) => {
      reject(error)
    })
  })
}
