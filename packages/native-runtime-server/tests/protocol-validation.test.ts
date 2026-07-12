import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_COMMANDS_PER_BATCH,
  MAX_SOCKET_MESSAGE_BYTES,
  ProtocolValidationError,
  parseJsonObject,
  validateHandshakeRequest,
  validateProtocolVersion,
  validateSocketMessageSize,
  validateSocketRequest
} from '../src/protocolValidation.ts'

describe('protocol validation', () => {
  it('validates handshake payload shape', () => {
    const handshake = validateHandshakeRequest({
      type: 'handshake',
      protocolVersion: 1,
      token: 'abc'
    })

    assert.equal(handshake.protocolVersion, 1)
    assert.equal(handshake.token, 'abc')
  })

  it('rejects unsupported protocol versions', () => {
    assert.throws(
      () => validateProtocolVersion(999),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolValidationError)
        assert.equal(error.code, 'protocol:unsupported-version')
        return true
      }
    )
  })

  it('rejects unknown methods', () => {
    assert.throws(
      () =>
        validateSocketRequest({
          requestId: 1,
          method: 'host:exec'
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolValidationError)
        assert.equal(error.code, 'protocol:unknown-method')
        return true
      }
    )
  })

  it('rejects invalid runtime:start options', () => {
    assert.throws(
      () =>
        validateSocketRequest({
          requestId: 2,
          method: 'runtime:start',
          params: {
            driver: 'alsa'
          }
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolValidationError)
        assert.equal(error.code, 'protocol:invalid-start-options')
        return true
      }
    )
  })

  it('rejects invalid plan payload shape', () => {
    assert.throws(
      () =>
        validateSocketRequest({
          requestId: 3,
          method: 'plan:prepare',
          params: 'not-an-object'
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolValidationError)
        assert.equal(error.code, 'protocol:invalid-plan-shape')
        return true
      }
    )
  })

  it('rejects oversized command batches', () => {
    assert.throws(
      () =>
        validateSocketRequest({
          requestId: 4,
          method: 'engine:commands',
          params: new Array(MAX_COMMANDS_PER_BATCH + 1).fill({ id: 'x' })
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolValidationError)
        assert.equal(error.code, 'protocol:command-batch-too-large')
        return true
      }
    )
  })

  it('rejects oversized messages', () => {
    assert.throws(
      () => validateSocketMessageSize(MAX_SOCKET_MESSAGE_BYTES + 1),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolValidationError)
        assert.equal(error.code, 'protocol:message-too-large')
        return true
      }
    )
  })

  it('parses strict JSON objects', () => {
    const payload = parseJsonObject('{"requestId":1,"method":"engine:snapshot"}')

    assert.equal(payload.requestId, 1)
    assert.equal(payload.method, 'engine:snapshot')
  })
})
