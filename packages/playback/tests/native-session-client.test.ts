import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NativeSessionClient, parseNativeSessionLine } from '../src/native/NativeSessionClient.ts'

const nativeEngineCwd = new URL('../../../native-audio-engine/', import.meta.url)
  .pathname

function createClient(): NativeSessionClient {
  return new NativeSessionClient({
    command: process.env.CARGO ?? '/Users/andrew/.cargo/bin/cargo',
    args: ['run', '-p', 'engine-host', '--', '--session-stdio'],
    cwd: nativeEngineCwd,
    shutdownTimeoutMs: 2_000
  })
}

describe('NativeSessionClient', () => {
  it('handshakes, starts null audio, snapshots, stops and shuts down', async () => {
    const client = createClient()

    try {
      const capabilities = await client.start()

      assert.equal(client.state, 'ready')
      assert.equal(capabilities.protocolVersion, 1)
      assert.ok(capabilities.drivers.includes('null'))

      const devices = await client.listAudioDevices('null')

      assert.equal(devices[0]?.id, 'null')

      const stream = await client.startAudio({
        driver: 'null',
        sampleRate: 48_000,
        bufferFrames: 128,
        channels: 2
      })

      assert.equal(client.state, 'audio-running')
      assert.equal(stream.deviceId, 'null')
      assert.equal(stream.sampleRate, 48_000)

      const snapshot = await client.getSnapshot()

      assert.equal(snapshot.stream?.deviceId, 'null')
      assert.ok((snapshot.telemetry?.samplePosition ?? 0) > 0)
      assert.equal(snapshot.transport?.playing, false)

      await client.sendEngineCommand({
        id: 'transport-start',
        type: 'transport:start',
        timeMs: 0,
        atSample: 0
      })

      const playingSnapshot = await client.getSnapshot()

      assert.equal(playingSnapshot.transport?.playing, true)
      assert.ok((playingSnapshot.transport?.samplePosition ?? 0) > 0)

      await client.sendEngineCommand({
        id: 'transport-stop',
        type: 'transport:stop',
        timeMs: 0,
        atSample: 0
      })

      const stoppedSnapshot = await client.getSnapshot()

      assert.equal(stoppedSnapshot.transport?.playing, false)

      await client.sendEngineCommand({
        id: 'tempo-map',
        type: 'tempo-map:set',
        originSample: 0,
        originBeat: 0,
        bpm: 120,
        sampleRate: 48_000,
        timeMs: 0,
        atSample: 0
      })

      await client.sendEngineCommand({
        id: 'transport-loop',
        type: 'transport-loop:set',
        enabled: true,
        startSample: 0,
        endSample: 96_000,
        timeMs: 0,
        atSample: 0
      })

      await client.sendEngineCommand({
        id: 'schedule-note-on',
        type: 'event:schedule-beat',
        clipId: 'clip-1',
        generation: 1,
        timeMs: 0,
        atSample: 0,
        event: {
          kind: 'note-on',
          targetNode: 5,
          note: 60,
          velocity: 0.75,
          atBeat: 1
        }
      })

      await client.sendEngineCommand({
        id: 'schedule-note-off',
        type: 'event:schedule-beat',
        clipId: 'clip-1',
        generation: 1,
        timeMs: 0,
        atSample: 0,
        event: {
          kind: 'note-off',
          targetNode: 5,
          note: 60,
          atBeat: 1.5
        }
      })

      await client.stopAudio()
      assert.equal(client.state, 'ready')
    } finally {
      await client.shutdown()
    }

    assert.equal(client.state, 'stopped')
  })

  it('can create and dispose repeated sessions', async () => {
    for (let index = 0; index < 2; index += 1) {
      const client = createClient()

      await client.start()
      await client.startAudio({
        driver: 'null',
        sampleRate: 48_000,
        bufferFrames: 64,
        channels: 2
      })
      await client.stopAudio()
      await client.shutdown()

      assert.equal(client.state, 'stopped')
    }
  })

  it('rejects malformed protocol lines', () => {
    assert.throws(
      () => parseNativeSessionLine('human log line'),
      /failed to parse native session JSONL/
    )
  })
})
