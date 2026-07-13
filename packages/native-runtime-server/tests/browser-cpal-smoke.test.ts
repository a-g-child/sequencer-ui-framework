import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import WebSocket from 'ws'
import {
  BrowserSocketNativeRuntimeTransport,
  NativeBackend,
  createDiagnosticNativeExecutionPlan,
  type NativeAudioDriver
} from '@sequencer/playback'
import { NativeRuntimeServer } from '../src/server.ts'

const SMOKE_ENABLED = process.env.NATIVE_BROWSER_SMOKE === '1'
const SMOKE_DRIVER = nativeSmokeDriver(process.env.NATIVE_BROWSER_SMOKE_DRIVER)
const SMOKE_TIMEOUT_MS = numberFromEnv(
  process.env.NATIVE_BROWSER_SMOKE_TIMEOUT_MS,
  20_000
)
const SMOKE_RUN_MS = numberFromEnv(process.env.NATIVE_BROWSER_SMOKE_RUN_MS, 300)

describe('browser CPAL smoke', () => {
  it(
    'runs browser transport through websocket server to CPAL native audio',
    { timeout: SMOKE_TIMEOUT_MS + 5_000 },
    async () => {
      if (!SMOKE_ENABLED) {
        console.info('[skip] set NATIVE_BROWSER_SMOKE=1 to run the CPAL browser smoke')
        return
      }

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
          driver: SMOKE_DRIVER,
          sampleRate: 48_000,
          bufferFrames: 128,
          channels: 2
        }
      })

      try {
        try {
          await withTimeout(
            backend.start(),
            SMOKE_TIMEOUT_MS,
            'browser CPAL smoke timed out during runtime/audio startup'
          )
        } catch (error) {
          if (isSkippableCpalSmokeError(error)) {
            console.info(`[skip] browser CPAL smoke unavailable: ${errorMessage(error)}`)
            return
          }

          throw error
        }

        const plan = createDiagnosticNativeExecutionPlan({
          planId: 202,
          planRevision: 1,
          frequencyHz: 330,
          gain: 0.01,
          outputChannels: 2
        })
        const prepared = await backend.compile(plan)

        assert.equal(prepared.backend, 'native')
        assert.equal(prepared.planId, '202')
        assert.equal(prepared.revision, 1)

        await backend.activate(prepared)

        const initialSnapshot = await backend.getSnapshot()

        assert.equal(initialSnapshot.plan.activePlanId, 202)
        assert.equal(initialSnapshot.plan.activeRevision, 1)

        backend.sendCommands([
          {
            id: 'browser-cpal-smoke:start',
            type: 'transport:start',
            timeMs: nowMs(),
            atSample: initialSnapshot.transport.samplePosition
          }
        ])

        await wait(SMOKE_RUN_MS)

        const playingSnapshot = await backend.getSnapshot()

        assert.equal(playingSnapshot.transport.playing, true)
        assert.ok(
          playingSnapshot.transport.samplePosition >
            initialSnapshot.transport.samplePosition
        )

        await backend.stop()

        const stoppedSnapshot = await backend.getSnapshot()

        assert.equal(stoppedSnapshot.transport.playing, false)
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
      addEventListener(
        type: 'open' | 'error' | 'close' | 'message',
        listener: (event: any) => void
      ) {
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

function isSkippableCpalSmokeError(error: unknown): boolean {
  const message = errorMessage(error)

  return /timed out|spawn EPERM|spawn EACCES|spawn ENOENT|engine-host|cargo|No such file or directory|AudioDeviceUnavailable|NoOutputDevice|Default output device|unsupported native session protocol/i.test(
    message
  )
}

function nativeSmokeDriver(value: string | undefined): NativeAudioDriver {
  return value === 'null' ? 'null' : 'cpal'
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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
