import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { NativeRuntimeManager } from '@sequencer/native-runtime-node'
import type {
  NativeAudioStartRequest,
  EngineCommand,
  NativeRuntimeStartOptions
} from '@sequencer/playback'
import { NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION } from '@sequencer/playback'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  NativeRuntimeSocketSession,
  type NativeRuntimeRequestHandler
} from './NativeRuntimeSocketSession.ts'

export interface NativeRuntimeServerOptions {
  readonly host?: string
  readonly port?: number
  readonly wsPath?: string
  readonly uiDirectory?: string
  readonly token?: string
  readonly managerFactory?: () => NativeRuntimeRequestHandler
  readonly ownerDisconnectGraceMs?: number
  readonly uiPort?: number
  readonly allowedOrigins?: readonly string[]
}

export interface NativeRuntimeServerHandle {
  readonly host: string
  readonly port: number
  readonly token?: string
  readonly wsPath: string
}

export interface RuntimeServerState {
  ownerConnectionId?: string
  manager?: NativeRuntimeRequestHandler
}

export class NativeRuntimeServer {
  private readonly host: string
  private readonly port: number
  private readonly wsPath: string
  private readonly uiDirectory?: string
  private readonly token?: string
  private readonly managerFactory: () => NativeRuntimeRequestHandler
  private readonly ownerDisconnectGraceMs: number
  private readonly uiPort?: number
  private readonly allowedOrigins: Set<string>

  private readonly httpServer: Server
  private readonly wsServer: WebSocketServer
  private readonly state: RuntimeServerState = {}
  private ownerReleaseTimer?: ReturnType<typeof setTimeout>

  constructor(options: NativeRuntimeServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1'
    this.port = options.port ?? 43127
    this.wsPath = options.wsPath ?? '/native-runtime'
    this.uiDirectory = options.uiDirectory
    this.token = options.token
    this.managerFactory = options.managerFactory ?? (() => new NativeRuntimeManager())
    this.ownerDisconnectGraceMs = options.ownerDisconnectGraceMs ?? 2_000
    this.uiPort = options.uiPort
    this.allowedOrigins = new Set(options.allowedOrigins ?? [])

    assertLoopbackHost(this.host)

    if (this.uiPort !== undefined) {
      this.allowedOrigins.add(`http://127.0.0.1:${this.uiPort}`)
      this.allowedOrigins.add(`http://localhost:${this.uiPort}`)
    }

    this.httpServer = createServer((req, res) => {
      void this.handleHttpRequest(req, res)
    })

    this.wsServer = new WebSocketServer({ noServer: true })

    this.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? this.host}`)
      const origin = request.headers.origin
      const hostHeader = request.headers.host

      if (url.pathname !== this.wsPath) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }

      if (!isAllowedOrigin(origin, hostHeader, this.allowedOrigins)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
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
      startAudio: async (request: NativeAudioStartRequest) => {
        return this.requireOwnerManager(connectionId).startAudio(request)
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

  private acquireOwnerManager(connectionId: string): NativeRuntimeRequestHandler {
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

  private requireOwnerManager(connectionId: string): NativeRuntimeRequestHandler {
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

  private async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    const requestedPath = new URL(req.url ?? '/', `http://${this.host}`).pathname

    if (requestedPath === '/health') {
      this.writeHealthResponse(req, res)
      return
    }

    if (!this.uiDirectory) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    const normalizedPath = requestedPath === '/' ? '/index.html' : requestedPath

    try {
      const filePath = resolveUiFilePath(this.uiDirectory, normalizedPath)
      const fileData = await readFile(filePath)
      const contentType = contentTypeForPath(filePath)

      res.statusCode = 200
      res.setHeader('Content-Type', contentType)

      if (req.method === 'HEAD') {
        res.end()
        return
      }

      res.end(fileData)
      return
    } catch {
      if (normalizedPath.startsWith('/assets/')) {
        res.statusCode = 404
        res.end('Not Found')
        return
      }
    }

    try {
      const indexPath = resolveUiFilePath(this.uiDirectory, '/index.html')
      const indexHtml = await readFile(indexPath)

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')

      if (req.method === 'HEAD') {
        res.end()
        return
      }

      res.end(indexHtml)
    } catch {
      res.statusCode = 404
      res.end('Not Found')
    }
  }

  private writeHealthResponse(req: IncomingMessage, res: ServerResponse): void {
    const runtimeOwned = Boolean(this.state.ownerConnectionId)
    const engineRunning = Boolean(this.state.manager)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    res.end(
      JSON.stringify({
        ok: true,
        protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
        runtimeOwned,
        engineRunning
      })
    )
  }
}

function resolveUiFilePath(uiDirectory: string, urlPathname: string): string {
  const root = resolve(uiDirectory)
  const relative = decodeURIComponent(urlPathname).replace(/^\/+/, '')
  const resolved = resolve(root, relative)

  if (resolved === root || resolved.startsWith(`${root}${sep}`)) {
    return resolved
  }

  throw createRuntimeError('server:invalid-path', 'Invalid static file path.')
}

function contentTypeForPath(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function assertLoopbackHost(host: string): void {
  if (isLoopbackHost(host)) {
    return
  }

  throw createRuntimeError(
    'server:invalid-host',
    `Native runtime server must bind to loopback only; received ${host}.`
  )
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function isAllowedOrigin(
  origin: string | undefined,
  hostHeader: string | undefined,
  allowedOrigins: ReadonlySet<string>
): boolean {
  if (!origin) {
    return false
  }

  if (allowedOrigins.has(origin)) {
    return true
  }

  if (!hostHeader) {
    return false
  }

  return origin === `http://${hostHeader}` || origin === `https://${hostHeader}`
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
