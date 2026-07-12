import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BrowserSocketNativeRuntimeTransport,
  NativeRuntimeBridgeError,
  NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
  type NativeRuntimeSocketRequest
} from '../src/index.ts'

describe('BrowserSocketNativeRuntimeTransport', () => {
  it('completes handshake and starts runtime successfully', async () => {
    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      if (request.method === 'runtime:start') {
        socket.sendServerMessage({
          requestId: request.requestId,
          ok: true,
          result: {
            protocolVersion: 1,
            capabilities: {
              executionPlanVersion: 1,
              eventGraphVersion: 1,
              parameterGraphVersion: 1,
              assets: false,
              telemetry: true
            },
            drivers: ['null', 'cpal'],
            messages: []
          }
        })
      }
    })

    const transport = createTransport(server)
    const session = await transport.start({ driver: 'null' })

    assert.equal(session.protocolVersion, 1)
    assert.deepEqual(session.drivers, ['null', 'cpal'])

    await transport.dispose()
  })

  it('correlates request responses even when responses arrive out of order', async () => {
    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      if (request.method === 'runtime:start') {
        socket.sendServerMessage({
          requestId: request.requestId,
          ok: true,
          result: {
            executionPlanVersion: 1,
            eventGraphVersion: 1,
            parameterGraphVersion: 1,
            assets: false,
            telemetry: true
          }
        })
        return
      }

      if (request.method === 'engine:snapshot') {
        const firstResponse = {
          requestId: request.requestId,
          ok: true,
          result: {
            transport: {
              playing: true,
              samplePosition: 222
            },
            telemetry: null
          }
        }

        if (request.requestId % 2 === 0) {
          setTimeout(() => {
            socket.sendServerMessage(firstResponse)
          }, 8)
        } else {
          setTimeout(() => {
            socket.sendServerMessage(firstResponse)
          }, 1)
        }
      }
    })

    const transport = createTransport(server)
    await transport.start({ driver: 'null' })

    const first = transport.getSnapshot()
    const second = transport.getSnapshot()

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second])

    assert.equal(firstSnapshot.transport?.samplePosition, 222)
    assert.equal(secondSnapshot.transport?.samplePosition, 222)

    await transport.dispose()
  })

  it('converts structured failures to NativeRuntimeBridgeError', async () => {
    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      if (request.method === 'runtime:start') {
        socket.sendServerMessage({
          requestId: request.requestId,
          ok: true,
          result: {
            executionPlanVersion: 1,
            eventGraphVersion: 1,
            parameterGraphVersion: 1,
            assets: false,
            telemetry: true
          }
        })
        return
      }

      socket.sendServerMessage({
        requestId: request.requestId,
        ok: false,
        error: {
          code: 'runtime:invalid-plan',
          message: 'Plan shape is invalid',
          details: { field: 'nodes' }
        }
      })
    })

    const transport = createTransport(server)
    await transport.start({ driver: 'null' })

    await assert.rejects(
      () => transport.preparePlan({ bad: true }),
      (error: unknown) => {
        assert.ok(error instanceof NativeRuntimeBridgeError)
        assert.equal(error.code, 'runtime:invalid-plan')
        assert.equal(error.message, 'Plan shape is invalid')
        assert.deepEqual(error.details, { field: 'nodes' })
        return true
      }
    )

    await transport.dispose()
  })

  it('delivers unsolicited events through onEvent callback', async () => {
    const events: string[] = []

    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      if (request.method === 'runtime:start') {
        socket.sendServerMessage({
          requestId: request.requestId,
          ok: true,
          result: {
            executionPlanVersion: 1,
            eventGraphVersion: 1,
            parameterGraphVersion: 1,
            assets: false,
            telemetry: true
          }
        })
        socket.sendServerMessage({
          type: 'runtime:status',
          payload: { state: 'running' }
        })
      }
    })

    const transport = createTransport(server, {
      onEvent: (event) => {
        events.push(event.type)
      }
    })

    await transport.start({ driver: 'null' })

    assert.deepEqual(events, ['runtime:status'])

    await transport.dispose()
  })

  it('rejects pending requests when socket disconnects unexpectedly', async () => {
    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      if (request.method === 'runtime:start') {
        socket.sendServerMessage({
          requestId: request.requestId,
          ok: true,
          result: {
            executionPlanVersion: 1,
            eventGraphVersion: 1,
            parameterGraphVersion: 1,
            assets: false,
            telemetry: true
          }
        })
        return
      }

      if (request.method === 'engine:snapshot') {
        setTimeout(() => {
          socket.closeFromServer(1011, 'server crashed')
        }, 1)
      }
    })

    const transport = createTransport(server)
    await transport.start({ driver: 'null' })

    await assert.rejects(
      () => transport.getSnapshot(),
      (error: unknown) => {
        assert.ok(error instanceof NativeRuntimeBridgeError)
        assert.equal(error.code, 'native-runtime:disconnected')
        return true
      }
    )

    await transport.dispose()
  })

  it('rejects duplicate runtime start calls', async () => {
    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      socket.sendServerMessage({
        requestId: request.requestId,
        ok: true,
        result: {
          executionPlanVersion: 1,
          eventGraphVersion: 1,
          parameterGraphVersion: 1,
          assets: false,
          telemetry: true
        }
      })
    })

    const transport = createTransport(server)
    await transport.start({ driver: 'null' })

    await assert.rejects(
      () => transport.start({ driver: 'null' }),
      (error: unknown) => {
        assert.ok(error instanceof NativeRuntimeBridgeError)
        assert.equal(error.code, 'native-runtime:already-started')
        return true
      }
    )

    await transport.dispose()
  })

  it('dispose is idempotent', async () => {
    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      socket.sendServerMessage({
        requestId: request.requestId,
        ok: true,
        result: {
          executionPlanVersion: 1,
          eventGraphVersion: 1,
          parameterGraphVersion: 1,
          assets: false,
          telemetry: true
        }
      })
    })

    const transport = createTransport(server)
    await transport.start({ driver: 'null' })

    await transport.dispose()
    await transport.dispose()

    assert.equal(server.closedCount, 1)
  })

  it('reports unknown response IDs without failing the connection', async () => {
    const warnings: string[] = []

    const server = new FakeSocketServer((socket, payload) => {
      if (payload.type === 'handshake') {
        socket.sendServerMessage({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
        })
        return
      }

      const request = payload as NativeRuntimeSocketRequest

      if (request.method === 'runtime:start') {
        socket.sendServerMessage({
          requestId: 999_999,
          ok: true,
          result: { ignored: true }
        })

        socket.sendServerMessage({
          requestId: request.requestId,
          ok: true,
          result: {
            executionPlanVersion: 1,
            eventGraphVersion: 1,
            parameterGraphVersion: 1,
            assets: false,
            telemetry: true
          }
        })
      }
    })

    const transport = createTransport(server, {
      onProtocolWarning: (warning) => {
        warnings.push(warning)
      }
    })

    await transport.start({ driver: 'null' })

    assert.equal(warnings.includes('Received response with unknown requestId.'), true)

    await transport.dispose()
  })
})

type JsonValue = Record<string, unknown>

class FakeSocketServer {
  private readonly onClientMessage: (socket: FakeSocket, payload: JsonValue) => void
  private currentSocket?: FakeSocket
  closedCount = 0

  constructor(onClientMessage: (socket: FakeSocket, payload: JsonValue) => void) {
    this.onClientMessage = onClientMessage
  }

  connect = (_url: string): FakeSocket => {
    const socket = new FakeSocket(this)

    this.currentSocket = socket
    queueMicrotask(() => {
      socket.openFromServer()
    })

    return socket
  }

  receiveFromClient(socket: FakeSocket, data: string): void {
    const payload = JSON.parse(data) as JsonValue
    this.onClientMessage(socket, payload)
  }

  notifyClosed(): void {
    this.closedCount += 1
  }

  get socket(): FakeSocket {
    if (!this.currentSocket) {
      throw new Error('No fake socket connected')
    }

    return this.currentSocket
  }
}

class FakeSocket {
  readonly readyState: number = 1

  private readonly listeners: {
    readonly open: Array<(event: { type: 'open' }) => void>
    readonly error: Array<(event: { type: 'error' }) => void>
    readonly close: Array<(event: { type: 'close'; code?: number; reason?: string }) => void>
    readonly message: Array<(event: { type: 'message'; data: string }) => void>
  } = {
    open: [],
    error: [],
    close: [],
    message: []
  }

  private isClosed = false

  constructor(private readonly server: FakeSocketServer) {}

  send(data: string): void {
    if (this.isClosed) {
      throw new Error('socket already closed')
    }

    this.server.receiveFromClient(this, data)
  }

  close(code?: number, reason?: string): void {
    if (this.isClosed) {
      return
    }

    this.isClosed = true
    this.server.notifyClosed()
    this.emit('close', { type: 'close', code, reason })
  }

  addEventListener<T extends { type: 'open' | 'error' | 'close' | 'message' }>(
    type: T['type'],
    listener: (event: T) => void
  ): void {
    const handler = listener as never

    switch (type) {
      case 'open':
        this.listeners.open.push(handler)
        return
      case 'error':
        this.listeners.error.push(handler)
        return
      case 'close':
        this.listeners.close.push(handler)
        return
      case 'message':
        this.listeners.message.push(handler)
        return
    }
  }

  removeEventListener<T extends { type: 'open' | 'error' | 'close' | 'message' }>(
    type: T['type'],
    listener: (event: T) => void
  ): void {
    const list =
      type === 'open'
        ? this.listeners.open
        : type === 'error'
          ? this.listeners.error
          : type === 'close'
            ? this.listeners.close
            : this.listeners.message

    const index = list.indexOf(listener as never)

    if (index >= 0) {
      list.splice(index, 1)
    }
  }

  openFromServer(): void {
    this.emit('open', { type: 'open' })
  }

  sendServerMessage(payload: unknown): void {
    this.emit('message', {
      type: 'message',
      data: JSON.stringify(payload)
    })
  }

  closeFromServer(code?: number, reason?: string): void {
    if (this.isClosed) {
      return
    }

    this.isClosed = true
    this.server.notifyClosed()
    this.emit('close', { type: 'close', code, reason })
  }

  private emit(
    type: 'open' | 'error' | 'close' | 'message',
    event:
      | { type: 'open' }
      | { type: 'error' }
      | { type: 'close'; code?: number; reason?: string }
      | { type: 'message'; data: string }
  ): void {
    const listeners =
      type === 'open'
        ? this.listeners.open
        : type === 'error'
          ? this.listeners.error
          : type === 'close'
            ? this.listeners.close
            : this.listeners.message

    for (const listener of listeners) {
      listener(event as never)
    }
  }
}

function createTransport(
  server: FakeSocketServer,
  options: Partial<{
    onEvent: (event: { type: string }) => void
    onProtocolWarning: (warning: string) => void
  }> = {}
): BrowserSocketNativeRuntimeTransport {
  return new BrowserSocketNativeRuntimeTransport({
    url: 'ws://127.0.0.1:43127/native-runtime',
    token: 'test-token',
    connectTimeoutMs: 100,
    requestTimeoutMs: 100,
    webSocketFactory: server.connect,
    onEvent: options.onEvent,
    onProtocolWarning: options.onProtocolWarning
  })
}
