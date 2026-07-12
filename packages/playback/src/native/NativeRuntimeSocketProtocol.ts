export const NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION = 1

export interface NativeRuntimeSocketHandshakeRequest {
  readonly type: 'handshake'
  readonly protocolVersion: number
  readonly token?: string
}

export interface NativeRuntimeSocketHandshakeSuccess {
  readonly type: 'handshake:ok'
  readonly protocolVersion: number
  readonly serverTimeMs?: number
}

export interface NativeRuntimeSocketHandshakeFailure {
  readonly type: 'handshake:error'
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: unknown
  }
}

export interface NativeRuntimeSocketRequest {
  readonly requestId: number
  readonly method:
    | 'runtime:start'
    | 'plan:prepare'
    | 'plan:activate'
    | 'engine:commands'
    | 'engine:snapshot'
    | 'audio:stop'
    | 'runtime:dispose'
  readonly params?: unknown
}

export interface NativeRuntimeSocketSuccess {
  readonly requestId: number
  readonly ok: true
  readonly result: unknown
}

export interface NativeRuntimeSocketFailure {
  readonly requestId: number
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: unknown
  }
}

export interface NativeRuntimeSocketEvent {
  readonly type:
    | 'runtime:event'
    | 'audio:event'
    | 'engine:event'
    | 'runtime:status'
  readonly payload: unknown
}

export type NativeRuntimeSocketHandshakeResponse =
  | NativeRuntimeSocketHandshakeSuccess
  | NativeRuntimeSocketHandshakeFailure

export type NativeRuntimeSocketResponse =
  | NativeRuntimeSocketSuccess
  | NativeRuntimeSocketFailure

export type NativeRuntimeSocketServerMessage =
  | NativeRuntimeSocketHandshakeResponse
  | NativeRuntimeSocketResponse
  | NativeRuntimeSocketEvent