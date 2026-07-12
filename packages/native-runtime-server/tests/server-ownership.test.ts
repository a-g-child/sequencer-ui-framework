import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import WebSocket from 'ws'
import { NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION } from '@sequencer/playback'
import { NativeRuntimeServer } from '../src/server.ts'

describe('NativeRuntimeServer ownership', () => {
  it('rejects second controlling client with RuntimeAlreadyOwned', async () => {
    const manager = new FakeManager()
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      ownerDisconnectGraceMs: 25,
      managerFactory: () => manager
    })

    const handle = await server.listen()
    const url = `ws://${handle.host}:${handle.port}${handle.wsPath}`
    const origin = `http://${handle.host}:${handle.port}`

    const owner = await connectClient(url, origin)
    await performHandshake(owner, 'test-token')
    const ownerStart = await sendRequest(owner, {
      requestId: 1,
      method: 'runtime:start',
      params: { driver: 'null' }
    })

    assert.equal(ownerStart.ok, true)

    const second = await connectClient(url, origin)
    await performHandshake(second, 'test-token')
    const secondStart = await sendRequest(second, {
      requestId: 2,
      method: 'runtime:start',
      params: { driver: 'null' }
    })

    assert.equal(secondStart.ok, false)
    assert.equal(secondStart.error?.code, 'runtime:already-owned')
    assert.equal(secondStart.error?.message, 'RuntimeAlreadyOwned')

    owner.close()
    second.close()
    await server.close()
  })

  it('disposes owner manager after disconnect grace period', async () => {
    const manager = new FakeManager()
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      ownerDisconnectGraceMs: 25,
      managerFactory: () => manager
    })

    const handle = await server.listen()
    const url = `ws://${handle.host}:${handle.port}${handle.wsPath}`
    const origin = `http://${handle.host}:${handle.port}`

    const owner = await connectClient(url, origin)
    await performHandshake(owner, 'test-token')
    const ownerStart = await sendRequest(owner, {
      requestId: 1,
      method: 'runtime:start',
      params: { driver: 'null' }
    })

    assert.equal(ownerStart.ok, true)
    assert.equal(manager.startCalls, 1)

    owner.close()
    await onceClose(owner)

    await waitMs(50)

    assert.equal(manager.disposeCalls, 1)

    await server.close()
  })
})

class FakeManager {
  startCalls = 0
  disposeCalls = 0

  async start(): Promise<unknown> {
    this.startCalls += 1
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

  async preparePlan(plan: unknown): Promise<unknown> {
    return { transferId: 1, planId: 1, revision: 1, plan }
  }

  async activatePlan(transferId: number, requestedSample?: number): Promise<unknown> {
    return { planId: 1, revision: 1, transferId, requestedSample: requestedSample ?? 0 }
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
    this.disposeCalls += 1
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
  assert.equal(message.protocolVersion, NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION)
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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
