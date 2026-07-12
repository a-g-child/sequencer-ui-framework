import { NativeRuntimeManager } from '@sequencer/native-runtime-node'
import {
  NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
  type EngineCommand,
  type NativeRuntimeSocketEvent,
  type NativeRuntimeSocketFailure,
  type NativeRuntimeSocketHandshakeFailure,
  type NativeRuntimeSocketRequest,
  type NativeRuntimeSocketSuccess,
  type NativeRuntimeStartOptions
} from '@sequencer/playback'
import {
  MAX_PENDING_REQUESTS,
  ProtocolValidationError,
  parseJsonObject,
  validateHandshakeRequest,
  validateProtocolVersion,
  validateSocketMessageSize,
  validateSocketRequest
} from './protocolValidation.ts'

export interface SocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface NativeRuntimeSocketSessionOptions {
  readonly connectionId: string
  readonly socket: SocketLike
  readonly manager?: NativeRuntimeRequestHandler
  readonly token?: string
  readonly onClose?: (connectionId: string) => Promise<void> | void
  readonly disposeManagerOnClose?: boolean
}

export interface NativeRuntimeRequestHandler {
  start(options?: NativeRuntimeStartOptions): Promise<unknown>
  preparePlan(plan: unknown): Promise<unknown>
  activatePlan(transferId: number, requestedSample?: number): Promise<unknown>
  sendCommands(commands: readonly EngineCommand[]): Promise<unknown>
  getSnapshot(): Promise<unknown>
  stopAudio(): Promise<void>
  dispose(): Promise<void>
}

export class NativeRuntimeSocketSession {
  private readonly connectionId: string
  private readonly socket: SocketLike
  private readonly manager: NativeRuntimeRequestHandler
  private readonly token?: string
  private readonly onCloseHook?: (connectionId: string) => Promise<void> | void
  private readonly disposeManagerOnClose: boolean
  private handshakeComplete = false
  private inFlightRequests = 0

  constructor(options: NativeRuntimeSocketSessionOptions) {
    this.connectionId = options.connectionId
    this.socket = options.socket
    this.manager = options.manager ?? new NativeRuntimeManager()
    this.token = options.token
    this.onCloseHook = options.onClose
    this.disposeManagerOnClose = options.disposeManagerOnClose ?? true
  }

  async onMessage(data: string | Buffer): Promise<void> {
    const text = typeof data === 'string' ? data : data.toString('utf8')

    validateSocketMessageSize(Buffer.byteLength(text, 'utf8'))

    const payload = parseJsonObject(text)

    if (!this.handshakeComplete) {
      this.handleHandshake(payload)
      return
    }

    const request = validateSocketRequest(payload)

    if (this.inFlightRequests >= MAX_PENDING_REQUESTS) {
      this.sendFailure(
        request.requestId,
        new ProtocolValidationError(
          'protocol:too-many-pending-requests',
          `Exceeded max pending requests: ${MAX_PENDING_REQUESTS}.`
        )
      )
      return
    }

    this.inFlightRequests += 1

    try {
      await this.handleRequest(request)
    } finally {
      this.inFlightRequests -= 1
    }
  }

  async onClose(): Promise<void> {
    if (this.disposeManagerOnClose) {
      await this.manager.dispose().catch(() => undefined)
    }

    await this.onCloseHook?.(this.connectionId)
  }

  sendEvent(event: NativeRuntimeSocketEvent): void {
    this.socket.send(JSON.stringify(event))
  }

  private handleHandshake(payload: Record<string, unknown>): void {
    try {
      const handshake = validateHandshakeRequest(payload)

      if (this.token && handshake.token !== this.token) {
        throw new ProtocolValidationError(
          'auth:invalid-token',
          'Native runtime token is invalid.'
        )
      }

      validateProtocolVersion(handshake.protocolVersion)

      this.handshakeComplete = true
      this.socket.send(
        JSON.stringify({
          type: 'handshake:ok',
          protocolVersion: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
          serverTimeMs: Date.now()
        })
      )
    } catch (error) {
      const failure = toHandshakeFailure(error)
      this.socket.send(JSON.stringify(failure))
      this.socket.close(1008, 'handshake failed')
    }
  }

  private async handleRequest(request: NativeRuntimeSocketRequest): Promise<void> {
    try {
      const result = await this.dispatch(request)
      const response: NativeRuntimeSocketSuccess = {
        requestId: request.requestId,
        ok: true,
        result
      }

      this.socket.send(JSON.stringify(response))
    } catch (error) {
      this.sendFailure(request.requestId, error)
    }
  }

  private sendFailure(requestId: number, error: unknown): void {
    const response: NativeRuntimeSocketFailure = {
      requestId,
      ok: false,
      error: {
        code: errorCode(error),
        message: errorMessage(error),
        details: errorDetails(error)
      }
    }

    this.socket.send(JSON.stringify(response))
  }

  private dispatch(request: NativeRuntimeSocketRequest): Promise<unknown> {
    switch (request.method) {
      case 'runtime:start':
        return this.manager.start((request.params ?? undefined) as NativeRuntimeStartOptions)
      case 'plan:prepare':
        return this.manager.preparePlan(request.params)
      case 'plan:activate': {
        const params = request.params as {
          readonly transferId: number
          readonly requestedSample?: number
        }

        return this.manager.activatePlan(params.transferId, params.requestedSample)
      }
      case 'engine:commands':
        return this.manager.sendCommands((request.params as readonly EngineCommand[]) ?? [])
      case 'engine:snapshot':
        return this.manager.getSnapshot()
      case 'audio:stop':
        return this.manager.stopAudio().then(() => undefined)
      case 'runtime:dispose':
        return this.manager.dispose().then(() => undefined)
    }
  }
}

function toHandshakeFailure(error: unknown): NativeRuntimeSocketHandshakeFailure {
  return {
    type: 'handshake:error',
    error: {
      code: errorCode(error),
      message: errorMessage(error),
      details: errorDetails(error)
    }
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ProtocolValidationError) {
    return error.code
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code

    if (typeof code === 'string' && code.length > 0) {
      return code
    }
  }

  return 'runtime:request-failed'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Native runtime request failed.'
}

function errorDetails(error: unknown): unknown {
  if (error instanceof ProtocolValidationError) {
    return error.details
  }

  if (error && typeof error === 'object' && 'details' in error) {
    return (error as { details?: unknown }).details
  }

  return undefined
}
