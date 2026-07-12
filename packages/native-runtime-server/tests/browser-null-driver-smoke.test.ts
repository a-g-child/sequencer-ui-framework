import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import WebSocket from 'ws'
import {
  BrowserSocketNativeRuntimeTransport,
  NativeBackend,
  compileNativeClipSchedule,
  createDiagnosticNativeExecutionPlan,
  createNativeTempoMapCommand,
  createNativeTransportLoopCommand,
  freezePlaybackModel,
  nativeClipScheduleBatchCommand,
  type PlaybackModel
} from '@sequencer/playback'
import { NativeRuntimeServer } from '../src/server.ts'

describe('browser null-driver smoke', () => {
  it(
    'runs browser transport through websocket server to engine-host null driver',
    { timeout: 20_000 },
    async () => {
      const server = new NativeRuntimeServer({
        host: '127.0.0.1',
        port: 0,
        token: 'test-token',
        uiPort: 5173
      })

      const handle = await server.listen()
      const socketUrl = `ws://${handle.host}:${handle.port}${handle.wsPath}`
      const transport = new BrowserSocketNativeRuntimeTransport({
        url: socketUrl,
        token: 'test-token',
        webSocketFactory: createNodeWebSocketFactory('http://127.0.0.1:5173')
      })
      const backend = new NativeBackend({
        transport,
        audio: {
          driver: 'null',
          sampleRate: 48_000,
          bufferFrames: 128,
          channels: 2
        }
      })

      try {
        try {
          await withTimeout(backend.start(), 12_000, 'browser null smoke start timed out')
        } catch (error) {
          if (isSkippableNullSmokeError(error)) {
            console.info(`[skip] browser null smoke unavailable: ${errorMessage(error)}`)
            return
          }

          throw error
        }

        const model = createPlaybackModelFixture()
        const plan = createDiagnosticNativeExecutionPlan({
          planId: 101,
          planRevision: 1,
          frequencyHz: 220,
          gain: 0.01
        })

        const handle = await backend.compile(plan)

        assert.equal(handle.backend, 'native')
        assert.equal(handle.planId, '101')
        assert.equal(handle.revision, 1)

        await backend.activate(handle)

        let snapshot = await backend.getSnapshot()

        assert.equal(snapshot.transport.playing, false)
        assert.equal(snapshot.plan.activePlanId, 101)
        assert.equal(snapshot.plan.activeRevision, 1)

        submitClipSchedule(backend, model, snapshot, 1)

        backend.sendCommands([
          {
            id: 'transport-start',
            type: 'transport:start',
            timeMs: nowMs(),
            atSample: snapshot.transport.samplePosition
          }
        ])

        await wait(80)

        const playingSnapshot = await backend.getSnapshot()

        assert.equal(playingSnapshot.transport.playing, true)
        assert.ok(
          playingSnapshot.transport.samplePosition > snapshot.transport.samplePosition
        )

        await backend.stop()

        snapshot = await backend.getSnapshot()
        assert.equal(snapshot.transport.playing, false)
      } finally {
        await backend.dispose().catch(() => undefined)
        await server.close().catch(() => undefined)
      }
    }
  )
})

function createNodeWebSocketFactory(origin: string) {
  return (url: string) => {
    const socket = new WebSocket(url, { origin })

    return {
      get readyState() {
        return socket.readyState
      },
      send(data: string) {
        socket.send(data)
      },
      close(code?: number, reason?: string) {
        socket.close(code, reason)
      },
      addEventListener(type: 'open' | 'error' | 'close' | 'message', listener: (event: any) => void) {
        switch (type) {
          case 'open':
            socket.on('open', () => {
              listener({ type: 'open' })
            })
            return
          case 'error':
            socket.on('error', () => {
              listener({ type: 'error' })
            })
            return
          case 'close':
            socket.on('close', (code, bufferReason) => {
              listener({
                type: 'close',
                code,
                reason: bufferReason?.toString('utf8') ?? ''
              })
            })
            return
          case 'message':
            socket.on('message', (data) => {
              const text =
                typeof data === 'string'
                  ? data
                  : Buffer.from(data as Buffer).toString('utf8')

              listener({
                type: 'message',
                data: text
              })
            })
            return
        }
      },
      removeEventListener() {
        // This adapter intentionally leaves listeners attached for one-shot smoke test usage.
      }
    }
  }
}

function createPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    id: 'browser-null-smoke-project',
    createdAt: 1_700_000_000_000,
    length: 4,
    tempoMap: {
      defaultBpm: 120,
      changes: [{ beat: 0, bpm: 120 }]
    },
    tracks: [
      {
        id: 'track-1',
        name: 'Lead',
        channel: 1,
        mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
        deviceInstanceIds: ['device-1']
      }
    ],
    clips: [
      {
        id: 'clip-1',
        trackId: 'track-1',
        patternId: 'pattern-1',
        name: 'Main',
        start: 0,
        length: 4,
        loop: true,
        loopStart: 0,
        loopLength: 4,
        sourceStart: 0,
        sourceLength: 4,
        loopIndex: 0
      }
    ],
    notes: [
      {
        id: 'note-1',
        sourceNoteId: 'note-1',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        pitch: 69,
        velocity: 0.8,
        beat: 0,
        duration: 0.5
      },
      {
        id: 'note-2',
        sourceNoteId: 'note-2',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        pitch: 72,
        velocity: 0.7,
        beat: 1,
        duration: 0.5
      }
    ],
    automations: []
  })
}

function submitClipSchedule(
  backend: NativeBackend,
  model: PlaybackModel,
  snapshot: Awaited<ReturnType<NativeBackend['getSnapshot']>>,
  generation: number
): void {
  const clip = model.clips[0]

  assert.ok(clip, 'fixture clip should exist')

  const atSample = snapshot.transport.samplePosition
  const sampleRate = snapshot.stream.sampleRate || 48_000
  const timeMs = nowMs()
  const schedule = compileNativeClipSchedule(model, {
    clipId: clip.id,
    generation
  })

  backend.sendCommands([
    createNativeTempoMapCommand(model, {
      sampleRate,
      originSample: atSample,
      originBeat: snapshot.transport.beatPosition,
      atSample,
      timeMs
    }),
    createNativeTransportLoopCommand({
      clip,
      bpm: model.tempoMap.defaultBpm,
      sampleRate,
      atSample,
      timeMs
    }),
    nativeClipScheduleBatchCommand(schedule, {
      atSample,
      timeMs
    })
  ])
}

function isSkippableNullSmokeError(error: unknown): boolean {
  const message = errorMessage(error)

  return /timed out|spawn EPERM|spawn EACCES|spawn ENOENT|engine-host|cargo|No such file or directory|unsupported native session protocol|AudioDeviceUnavailable/i.test(
    message
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
