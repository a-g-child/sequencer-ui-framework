import {
  NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION,
  type NativeRuntimeSocketHandshakeRequest,
  type NativeRuntimeSocketRequest
} from '@sequencer/playback'

export const MAX_SOCKET_MESSAGE_BYTES = 2 * 1024 * 1024
export const MAX_COMMANDS_PER_BATCH = 4096
export const MAX_PENDING_REQUESTS = 256

export class ProtocolValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'ProtocolValidationError'
  }
}

const REQUEST_METHODS = new Set([
  'runtime:start',
  'plan:prepare',
  'plan:activate',
  'engine:commands',
  'engine:snapshot',
  'audio:stop',
  'runtime:dispose'
] as const)

export function validateSocketMessageSize(byteLength: number): void {
  if (byteLength > MAX_SOCKET_MESSAGE_BYTES) {
    throw new ProtocolValidationError(
      'protocol:message-too-large',
      `Socket message exceeds ${MAX_SOCKET_MESSAGE_BYTES} bytes.`,
      { byteLength }
    )
  }
}

export function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ProtocolValidationError('protocol:invalid-json', 'Message must be valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProtocolValidationError(
      'protocol:invalid-shape',
      'Socket message must be a JSON object.'
    )
  }

  return parsed as Record<string, unknown>
}

export function validateHandshakeRequest(
  payload: Record<string, unknown>
): NativeRuntimeSocketHandshakeRequest {
  if (payload.type !== 'handshake') {
    throw new ProtocolValidationError(
      'protocol:handshake-required',
      'First message must be a handshake.'
    )
  }

  if (!Number.isInteger(payload.protocolVersion)) {
    throw new ProtocolValidationError(
      'protocol:invalid-protocol-version',
      'Handshake protocolVersion must be an integer.'
    )
  }

  return {
    type: 'handshake',
    protocolVersion: payload.protocolVersion as number,
    token: typeof payload.token === 'string' ? payload.token : undefined
  }
}

export function validateProtocolVersion(protocolVersion: number): void {
  if (protocolVersion !== NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      'protocol:unsupported-version',
      `Unsupported protocol version ${protocolVersion}.`,
      {
        supported: NATIVE_RUNTIME_SOCKET_PROTOCOL_VERSION
      }
    )
  }
}

export function validateSocketRequest(
  payload: Record<string, unknown>
): NativeRuntimeSocketRequest {
  const requestId = payload.requestId
  const method = payload.method

  if (!Number.isInteger(requestId) || (requestId as number) < 0) {
    throw new ProtocolValidationError(
      'protocol:invalid-request-id',
      'requestId must be a non-negative integer.'
    )
  }

  if (typeof method !== 'string' || !REQUEST_METHODS.has(method as never)) {
    throw new ProtocolValidationError(
      'protocol:unknown-method',
      'method is not supported by this runtime server.',
      { method }
    )
  }

  if (method === 'plan:activate') {
    const params = payload.params

    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new ProtocolValidationError(
        'protocol:invalid-activation-handle',
        'plan:activate expects an object payload.'
      )
    }

    const transferId = (params as Record<string, unknown>).transferId

    if (!Number.isInteger(transferId) || (transferId as number) < 0) {
      throw new ProtocolValidationError(
        'protocol:invalid-activation-handle',
        'plan:activate requires a non-negative integer transferId.'
      )
    }
  }

  if (method === 'runtime:start') {
    const params = payload.params

    if (params !== undefined) {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new ProtocolValidationError(
          'protocol:invalid-start-options',
          'runtime:start expects an object options payload.'
        )
      }

      const options = params as Record<string, unknown>

      if (
        options.driver !== undefined &&
        options.driver !== 'null' &&
        options.driver !== 'cpal'
      ) {
        throw new ProtocolValidationError(
          'protocol:invalid-start-options',
          'runtime:start driver must be null or cpal.'
        )
      }

      for (const key of ['sampleRate', 'bufferFrames', 'channels'] as const) {
        const value = options[key]

        if (value !== undefined && (!Number.isInteger(value) || (value as number) <= 0)) {
          throw new ProtocolValidationError(
            'protocol:invalid-start-options',
            `runtime:start ${key} must be a positive integer.`
          )
        }
      }
    }
  }

  if (method === 'plan:prepare') {
    const params = payload.params

    if (!params || typeof params !== 'object') {
      throw new ProtocolValidationError(
        'protocol:invalid-plan-shape',
        'plan:prepare expects an object execution plan payload.'
      )
    }
  }

  if (method === 'engine:commands') {
    if (!Array.isArray(payload.params)) {
      throw new ProtocolValidationError(
        'protocol:invalid-command-batch',
        'engine:commands expects an array payload.'
      )
    }

    if (payload.params.length > MAX_COMMANDS_PER_BATCH) {
      throw new ProtocolValidationError(
        'protocol:command-batch-too-large',
        `engine:commands exceeds max batch size ${MAX_COMMANDS_PER_BATCH}.`,
        { batchSize: payload.params.length }
      )
    }
  }

  return {
    requestId: requestId as number,
    method: method as NativeRuntimeSocketRequest['method'],
    params: payload.params
  }
}
