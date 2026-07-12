import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { NativeRuntimeManager } from '@sequencer/native-runtime-node'
import type {
  EngineCommand,
  NativeRuntimeStartOptions
} from '@sequencer/playback'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  NativeRuntimeSocketSession,
  type NativeRuntimeRequestHandler
} from './NativeRuntimeSocketSession.ts'

export interface NativeRuntimeServerOptions {
  readonly host?: string
  readonly port?: number
  readonly wsPath?: string
  readonly token?: string
  readonly managerFactory?: () => NativeRuntimeManager
  readonly ownerDisconnectGraceMs?: number
}

export interface NativeRuntimeServerHandle {
  readonly host: string
  readonly port: number
  readonly token?: string
  readonly wsPath: string
}

export interface RuntimeServerState {
  ownerConnectionId?: string
  manager?: NativeRuntimeManager
}

export class NativeRuntimeServer {
  private readonly host: string
  private readonly port: number
  private readonly wsPath: string
  private readonly token?: string
  private readonly managerFactory: () => NativeRuntimeManager
  private readonly ownerDisconnectGraceMs: number

  private readonly httpServer: Server
  private readonly wsServer: WebSocketServer
  private readonly state: RuntimeServerState = {}
  private ownerReleaseTimer?: ReturnType<typeof setTimeout>

  constructor(options: NativeRuntimeServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1'
    this.port = options.port ?? 43127
    this.wsPath = options.wsPath ?? '/native-runtime'
    this.token = options.token
    this.managerFactory = options.managerFactory ?? (() => new NativeRuntimeManager())
    this.ownerDisconnectGraceMs = options.ownerDisconnectGraceMs ?? 2_000

    this.httpServer = createServer((_req, res) => {
      res.statusCode = 404
      res.end('Not Found')
    })

    this.wsServer = new WebSocketServer({ noServer: true })

    this.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? this.host}`)

      if (url.pathname !== this.wsPath) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }

      this.wsServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.wsServer.emit('connection', webSocket, request)
      })
    })

    this.wsServer.on('connection', (socket: WebSocket) => {
      const connectionId = randomUUID()
      const session = new NativeRuntimeSocketSession({
        connectionId,
        socket,
        manager: this.createConnectionManager(connectionId),
        token: this.token,
        disposeManagerOnClose: false,
        onClose: (closedConnectionId) => this.handleConnectionClosed(closedConnectionId)
      })

      socket.on('message', (data: RawData) => {
        void session.onMessage(toText(data)).catch(() => {
          socket.close(1011, 'request failure')
        })
      })

      socket.on('close', () => {
        void session.onClose()
      })
    })
  }

  async listen(): Promise<NativeRuntimeServerHandle> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.once('error', reject)
      this.httpServer.listen(this.port, this.host, () => {
        this.httpServer.off('error', reject)
        resolve()
      })
    })

    const address = this.httpServer.address()
    const boundPort =
      address && typeof address === 'object' ? address.port : this.port

    return {
      host: this.host,
      port: boundPort,
      token: this.token,
      wsPath: this.wsPath
    }
  }

  async close(): Promise<void> {
    if (this.ownerReleaseTimer) {
      clearTimeout(this.ownerReleaseTimer)
      this.ownerReleaseTimer = undefined
    }

    await this.state.manager?.dispose().catch(() => undefined)
    this.state.manager = undefined
    this.state.ownerConnectionId = undefined

    await new Promise<void>((resolve, reject) => {
      this.wsServer.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })

    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  private createConnectionManager(connectionId: string): NativeRuntimeRequestHandler {
    return {
      start: async (options?: NativeRuntimeStartOptions) => {
        const manager = this.acquireOwnerManager(connectionId)
        return manager.start(options)
      },
      preparePlan: async (plan: unknown) => {
        return this.requireOwnerManager(connectionId).preparePlan(plan)
      },
      activatePlan: async (transferId: number, requestedSample?: number) => {
        return this.requireOwnerManager(connectionId).activatePlan(
          transferId,
          requestedSample
        )
      },
      sendCommands: async (commands: readonly EngineCommand[]) => {
        return this.requireOwnerManager(connectionId).sendCommands(commands)
      },
      getSnapshot: async () => {
        return this.requireOwnerManager(connectionId).getSnapshot()
      },
      stopAudio: async () => {
        await this.requireOwnerManager(connectionId).stopAudio()
      },
      dispose: async () => {
        const manager = this.requireOwnerManager(connectionId)
        await manager.dispose()
        this.state.manager = undefined
        this.state.ownerConnectionId = undefined
      }
    }
  }

  private acquireOwnerManager(connectionId: string): NativeRuntimeManager {
    if (
      this.state.ownerConnectionId &&
      this.state.ownerConnectionId !== connectionId
    ) {
      throw runtimeAlreadyOwnedError(this.state.ownerConnectionId)
    }

    this.state.ownerConnectionId = connectionId

    if (this.ownerReleaseTimer) {
      clearTimeout(this.ownerReleaseTimer)
      this.ownerReleaseTimer = undefined
    }

    if (!this.state.manager) {
      this.state.manager = this.managerFactory()
    }

    return this.state.manager
  }

  private requireOwnerManager(connectionId: string): NativeRuntimeManager {
    if (!this.state.ownerConnectionId || this.state.ownerConnectionId !== connectionId) {
      if (this.state.ownerConnectionId) {
        throw runtimeAlreadyOwnedError(this.state.ownerConnectionId)
      }

      throw createRuntimeError(
        'runtime:not-started',
        'Native runtime is not started for this connection.'
      )
    }

    if (!this.state.manager) {
      throw createRuntimeError('runtime:not-started', 'Native runtime is not started.')
    }

    return this.state.manager
  }

  private async handleConnectionClosed(connectionId: string): Promise<void> {
    if (this.state.ownerConnectionId !== connectionId) {
      return
    }

    this.state.ownerConnectionId = undefined

    if (!this.state.manager) {
      return
    }

    if (this.ownerReleaseTimer) {
      clearTimeout(this.ownerReleaseTimer)
      this.ownerReleaseTimer = undefined
    }

    this.ownerReleaseTimer = setTimeout(() => {
      if (this.state.ownerConnectionId || !this.state.manager) {
        return
      }

      void this.state.manager.dispose().catch(() => undefined)
      this.state.manager = undefined
      this.ownerReleaseTimer = undefined
    }, this.ownerDisconnectGraceMs)
  }
}

function toText(data: RawData): string {
  if (typeof data === 'string') {
    return data
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8')
  }

  return data.toString('utf8')
}

function runtimeAlreadyOwnedError(ownerConnectionId: string): Error {
  return createRuntimeError(
    'runtime:already-owned',
    'RuntimeAlreadyOwned',
    { ownerConnectionId }
  )
}

function createRuntimeError(code: string, message: string, details?: unknown): Error {
  const error = new Error(message) as Error & {
    code?: string
    details?: unknown
  }

  error.code = code
  error.details = details

  return error
}
