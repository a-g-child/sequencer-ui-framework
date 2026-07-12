import type { EngineCommand } from './schemas.ts'
import {
  NativeRuntimeBridgeError,
  type NativeRuntimeStartOptions
} from './NativeRuntimeApi.ts'
import type {
  NativeActiveStreamInfo,
  NativeAudioDeviceInfo,
  NativeAudioDriver,
  NativeAudioStartRequest,
  NativeEngineCommandResponse,
  NativeEngineSnapshot,
  NativePlanActivation,
  NativePreparedPlanHandle,
  NativeRuntimeCapabilities,
  NativeRuntimeTransport,
  NativeSessionCapabilities
} from './NativeRuntimeTransport.ts'
import {
  NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
  type NativeRuntimeSocketEvent,
  type NativeRuntimeSocketFailure,
  type NativeRuntimeSocketHandshakeFailure,
  type NativeRuntimeSocketHandshakeResponse,
  type NativeRuntimeSocketHandshakeSuccess,
  type NativeRuntimeSocketResponse,
  type NativeRuntimeSocketServerMessage,
  type NativeRuntimeSocketSuccess
} from './NativeRuntimeSocketProtocol.ts'

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

interface WebSocketOpenEvent {
  readonly type: 'open'
}

interface WebSocketErrorEvent {
  readonly type: 'error'
}

interface WebSocketCloseEvent {
  readonly type: 'close'
  readonly code?: number
  readonly reason?: string
}

interface WebSocketMessageEvent {
  readonly type: 'message'
  readonly data?: unknown
}

type WebSocketEvent =
  | WebSocketOpenEvent
  | WebSocketErrorEvent
  | WebSocketCloseEvent
  | WebSocketMessageEvent

type WebSocketEventType = WebSocketEvent['type']

type WebSocketListener<T extends WebSocketEvent> = (event: T) => void

interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener<T extends WebSocketEvent>(
    type: T['type'],
    listener: WebSocketListener<T>
  ): void
  removeEventListener<T extends WebSocketEvent>(
    type: T['type'],
    listener: WebSocketListener<T>
  ): void
}

export interface BrowserSocketNativeRuntimeTransportOptions {
  readonly url: string
  readonly token?: string
  readonly protocolVersion?: number
  readonly connectTimeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly webSocketFactory?: (url: string) => WebSocketLike
  readonly onEvent?: (event: NativeRuntimeSocketEvent) => void
  readonly onProtocolWarning?: (warning: string, payload?: unknown) => void
}

export class BrowserSocketNativeRuntimeTransport
  implements NativeRuntimeTransport
{
  private readonly url: string
  private readonly token?: string
  private readonly protocolVersion: number
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private readonly onEvent?: (event: NativeRuntimeSocketEvent) => void
  private readonly onProtocolWarning?: (warning: string, payload?: unknown) => void

  private socket?: WebSocketLike
  private handshakeComplete = false
  private session?: NativeSessionCapabilities
  private runtimeStarted = false
  private disposed = false
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()

  private readonly listeners: {
    readonly open: WebSocketListener<WebSocketOpenEvent>
    readonly error: WebSocketListener<WebSocketErrorEvent>
    readonly close: WebSocketListener<WebSocketCloseEvent>
    readonly message: WebSocketListener<WebSocketMessageEvent>
  }

  private connectPromise?: Promise<void>

  constructor(options: BrowserSocketNativeRuntimeTransportOptions) {
    this.url = options.url
    this.token = options.token
    this.protocolVersion =
      options.protocolVersion ?? NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.webSocketFactory = options.webSocketFactory ?? createDefaultWebSocket
    this.onEvent = options.onEvent
    this.onProtocolWarning = options.onProtocolWarning

    this.listeners = {
      open: () => undefined,
      error: () => undefined,
      close: (event) => {
        const error = new NativeRuntimeBridgeError(
          'native-runtime:disconnected',
          `Native runtime socket disconnected (${event.code ?? 1006}: ${event.reason ?? 'unknown reason'})`
        )

        this.rejectAllPending(error)
        this.handshakeComplete = false
        this.connectPromise = undefined
        this.socket = undefined
        this.runtimeStarted = false
      },
      message: (event) => {
        this.handleSocketMessage(event)
      }
    }
  }

  async start(options?: NativeRuntimeStartOptions): Promise<NativeSessionCapabilities> {
    this.ensureNotDisposed()

    if (this.runtimeStarted) {
      throw new NativeRuntimeBridgeError(
        'native-runtime:already-started',
        'Native runtime socket transport has already started.'
      )
    }

    await this.ensureConnected()

    const result = await this.sendRequest('runtime:start', options)
    const session = normalizeSessionCapabilities(result, this.protocolVersion)

    this.session = session
    this.runtimeStarted = true

    return session
  }

  async listAudioDevices(driver: NativeAudioDriver): Promise<NativeAudioDeviceInfo[]> {
    this.ensureNotDisposed()
    await this.ensureConnected()

    this.onProtocolWarning?.(
      'Native runtime socket protocol does not define listAudioDevices; returning empty list.',
      { driver }
    )

    return []
  }

  async startAudio(request: NativeAudioStartRequest): Promise<NativeActiveStreamInfo> {
    this.ensureNotDisposed()

    if (!this.runtimeStarted) {
      const session = await this.start(request)
      this.session = session
    }

    return {
      driver: request.driver,
      deviceId: request.device ?? request.driver,
      deviceName: request.device ?? request.driver,
      sampleRate: request.sampleRate ?? 48_000,
      channels: request.channels ?? 2,
      sampleFormat: 'f32',
      requestedBufferFrames: request.bufferFrames
    }
  }

  async stopAudio(): Promise<void> {
    this.ensureNotDisposed()
    await this.ensureConnected()
    this.ensureRuntimeStarted()

    await this.sendRequest('audio:stop', undefined)
  }

  async preparePlan(plan: unknown): Promise<NativePreparedPlanHandle> {
    this.ensureNotDisposed()
    await this.ensureConnected()
    this.ensureRuntimeStarted()

    return (await this.sendRequest('plan:prepare', plan)) as NativePreparedPlanHandle
  }

  async activatePlan(
    transferId: number,
    requestedSample = 0
  ): Promise<NativePlanActivation> {
    this.ensureNotDisposed()
    await this.ensureConnected()
    this.ensureRuntimeStarted()

    return (await this.sendRequest('plan:activate', {
      transferId,
      requestedSample
    })) as NativePlanActivation
  }

  async sendCommands(
    commands: readonly EngineCommand[]
  ): Promise<readonly NativeEngineCommandResponse[]> {
    this.ensureNotDisposed()
    await this.ensureConnected()
    this.ensureRuntimeStarted()

    return (await this.sendRequest('engine:commands', commands)) as readonly NativeEngineCommandResponse[]
  }

  async getSnapshot(): Promise<NativeEngineSnapshot> {
    this.ensureNotDisposed()
    await this.ensureConnected()
    this.ensureRuntimeStarted()

    return (await this.sendRequest('engine:snapshot', undefined)) as NativeEngineSnapshot
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true

    const socket = this.socket

    this.rejectAllPending(
      new NativeRuntimeBridgeError(
        'native-runtime:disposed',
        'Native runtime socket transport was disposed.'
      )
    )

    this.socket = undefined
    this.connectPromise = undefined
    this.handshakeComplete = false
    this.runtimeStarted = false

    if (socket) {
      removeListeners(socket, this.listeners)
      socket.close(1000, 'dispose')
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.handshakeComplete && this.socket) {
      return
    }

    if (!this.connectPromise) {
      this.connectPromise = this.connectAndHandshake().catch((error) => {
        this.connectPromise = undefined
        throw error
      })
    }

    return this.connectPromise
  }

  private async connectAndHandshake(): Promise<void> {
    this.ensureNotDisposed()

    const socket = this.webSocketFactory(this.url)
    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new NativeRuntimeBridgeError(
            'native-runtime:connect-timeout',
            `Timed out connecting to native runtime bridge at ${this.url}.`
          )
        )
      }, this.connectTimeoutMs)

      const onOpen: WebSocketListener<WebSocketOpenEvent> = () => {
        clearTimeout(timeout)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
        resolve()
      }

      const onError: WebSocketListener<WebSocketErrorEvent> = () => {
        clearTimeout(timeout)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
        reject(
          new NativeRuntimeBridgeError(
            'native-runtime:unavailable',
            `Unable to reach native runtime bridge at ${this.url}.`
          )
        )
      }

      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
    })

    addListeners(socket, this.listeners)

    const handshakeResult = await this.sendHandshake(socket)

    if (handshakeResult.type === 'handshake:error') {
      throw createBridgeErrorFromHandshakeFailure(handshakeResult)
    }

    this.handshakeComplete = true
  }

  private sendHandshake(
    socket: WebSocketLike
  ): Promise<NativeRuntimeSocketHandshakeResponse> {
    return new Promise<NativeRuntimeSocketHandshakeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new NativeRuntimeBridgeError(
            'native-runtime:handshake-timeout',
            `Timed out waiting for native runtime bridge handshake at ${this.url}.`
          )
        )
      }, this.connectTimeoutMs)

      const onMessage: WebSocketListener<WebSocketMessageEvent> = (event) => {
        const payload = parseSocketMessage(event.data)

        if (!payload || !isHandshakeMessage(payload)) {
          return
        }

        clearTimeout(timeout)
        socket.removeEventListener('message', onMessage)
        resolve(payload)
      }

      socket.addEventListener('message', onMessage)

      socket.send(
        JSON.stringify({
          type: 'handshake',
          protocolVersion: this.protocolVersion,
          token: this.token
        })
      )
    })
  }

  private async sendRequest(
    method:
      | 'runtime:start'
      | 'plan:prepare'
      | 'plan:activate'
      | 'engine:commands'
      | 'engine:snapshot'
      | 'audio:stop'
      | 'runtime:dispose',
    params: unknown
  ): Promise<unknown> {
    if (!this.handshakeComplete || !this.socket) {
      throw new NativeRuntimeBridgeError(
        'native-runtime:not-ready',
        'Native runtime socket handshake has not completed.'
      )
    }

    const requestId = this.nextRequestId++

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(
          new NativeRuntimeBridgeError(
            'native-runtime:request-timeout',
            `Timed out waiting for response to ${method}.`,
            { requestId, method }
          )
        )
      }, this.requestTimeoutMs)

      this.pending.set(requestId, {
        resolve,
        reject,
        timeout
      })
    })

    this.socket.send(
      JSON.stringify({
        requestId,
        method,
        params
      })
    )

    return responsePromise
  }

  private handleSocketMessage(event: WebSocketMessageEvent): void {
    const message = parseSocketMessage(event.data)

    if (!message || !isServerMessage(message)) {
      this.onProtocolWarning?.('Ignoring non-protocol socket message.', event.data)
      return
    }

    if (isHandshakeMessage(message)) {
      // Handshake messages are handled by the temporary handshake listener.
      return
    }

    if (isSocketEvent(message)) {
      this.onEvent?.(message)
      return
    }

    if (!isSocketResponse(message)) {
      this.onProtocolWarning?.('Ignoring unknown server message.', message)
      return
    }

    const pending = this.pending.get(message.requestId)

    if (!pending) {
      this.onProtocolWarning?.('Received response with unknown requestId.', message)
      return
    }

    this.pending.delete(message.requestId)
    clearTimeout(pending.timeout)

    if (message.ok) {
      pending.resolve((message as NativeRuntimeSocketSuccess).result)
      return
    }

    pending.reject(createBridgeErrorFromFailure(message as NativeRuntimeSocketFailure))
  }

  private ensureRuntimeStarted(): void {
    if (!this.runtimeStarted) {
      throw new NativeRuntimeBridgeError(
        'native-runtime:not-started',
        'Native runtime must be started before issuing runtime commands.'
      )
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new NativeRuntimeBridgeError(
        'native-runtime:disposed',
        'Native runtime socket transport was disposed.'
      )
    }
  }

  private rejectAllPending(error: unknown): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(requestId)
    }
  }
}

function normalizeSessionCapabilities(
  value: unknown,
  fallbackProtocolVersion: number
): NativeSessionCapabilities {
  if (isSessionCapabilities(value)) {
    return value
  }

  if (isRuntimeCapabilities(value)) {
    return {
      protocolVersion: fallbackProtocolVersion,
      capabilities: value,
      drivers: ['null'],
      messages: []
    }
  }

  throw new NativeRuntimeBridgeError(
    'native-runtime:protocol-error',
    'runtime:start returned an invalid session payload.',
    value
  )
}

function isRuntimeCapabilities(value: unknown): value is NativeRuntimeCapabilities {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.executionPlanVersion === 'number' &&
    typeof candidate.eventGraphVersion === 'number' &&
    typeof candidate.parameterGraphVersion === 'number' &&
    typeof candidate.assets === 'boolean' &&
    typeof candidate.telemetry === 'boolean'
  )
}

function isSessionCapabilities(value: unknown): value is NativeSessionCapabilities {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.protocolVersion === 'number' &&
    Array.isArray(candidate.drivers) &&
    Array.isArray(candidate.messages) &&
    isRuntimeCapabilities(candidate.capabilities)
  )
}

function createBridgeErrorFromFailure(
  failure: NativeRuntimeSocketFailure
): NativeRuntimeBridgeError {
  return new NativeRuntimeBridgeError(
    failure.error.code,
    failure.error.message,
    failure.error.details
  )
}

function createBridgeErrorFromHandshakeFailure(
  failure: NativeRuntimeSocketHandshakeFailure
): NativeRuntimeBridgeError {
  return new NativeRuntimeBridgeError(
    failure.error.code,
    failure.error.message,
    failure.error.details
  )
}

function parseSocketMessage(payload: unknown): unknown {
  if (typeof payload !== 'string') {
    return undefined
  }

  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

function isServerMessage(value: unknown): value is NativeRuntimeSocketServerMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    candidate.type === 'handshake:ok' ||
    candidate.type === 'handshake:error' ||
    (typeof candidate.requestId === 'number' && typeof candidate.ok === 'boolean') ||
    isSocketEvent(candidate)
  )
}

function isHandshakeMessage(
  value: unknown
): value is NativeRuntimeSocketHandshakeResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return candidate.type === 'handshake:ok' || candidate.type === 'handshake:error'
}

function isSocketEvent(value: unknown): value is NativeRuntimeSocketEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    (candidate.type === 'runtime:event' ||
      candidate.type === 'audio:event' ||
      candidate.type === 'engine:event' ||
      candidate.type === 'runtime:status') &&
    'payload' in candidate
  )
}

function isSocketResponse(value: unknown): value is NativeRuntimeSocketResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return typeof candidate.requestId === 'number' && typeof candidate.ok === 'boolean'
}

function addListeners(
  socket: WebSocketLike,
  listeners: {
    readonly open: WebSocketListener<WebSocketOpenEvent>
    readonly error: WebSocketListener<WebSocketErrorEvent>
    readonly close: WebSocketListener<WebSocketCloseEvent>
    readonly message: WebSocketListener<WebSocketMessageEvent>
  }
): void {
  socket.addEventListener('open', listeners.open)
  socket.addEventListener('error', listeners.error)
  socket.addEventListener('close', listeners.close)
  socket.addEventListener('message', listeners.message)
}

function removeListeners(
  socket: WebSocketLike,
  listeners: {
    readonly open: WebSocketListener<WebSocketOpenEvent>
    readonly error: WebSocketListener<WebSocketErrorEvent>
    readonly close: WebSocketListener<WebSocketCloseEvent>
    readonly message: WebSocketListener<WebSocketMessageEvent>
  }
): void {
  socket.removeEventListener('open', listeners.open)
  socket.removeEventListener('error', listeners.error)
  socket.removeEventListener('close', listeners.close)
  socket.removeEventListener('message', listeners.message)
}

function createDefaultWebSocket(url: string): WebSocketLike {
  if (typeof WebSocket === 'undefined') {
    throw new NativeRuntimeBridgeError(
      'native-runtime:websocket-unavailable',
      'WebSocket is not available in this runtime.'
    )
  }

  return new WebSocket(url) as unknown as WebSocketLike
}
