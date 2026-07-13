import { randomBytes } from 'node:crypto'
import { NativeRuntimeServer } from './server.ts'

export * from './server.ts'
export * from './NativeRuntimeSocketSession.ts'
export * from './protocolValidation.ts'

export async function startNativeRuntimeServer(): Promise<NativeRuntimeServer> {
  const token = randomBytes(16).toString('hex')
  const uiPort = numberFromEnv(process.env.NATIVE_RUNTIME_UI_PORT, 5173)
  const server = new NativeRuntimeServer({ token, uiPort })

  const handle = await server.listen()

  const baseUrl = `http://${handle.host}:${handle.port}`
  const socketUrl = `ws://${handle.host}:${handle.port}${handle.wsPath}`

  // Print launch URL for local development/kiosk startup integration.
  console.log(`${baseUrl}/?nativeToken=${token}`)
  console.log(`Vite dev URL: http://localhost:${uiPort}/?nativeToken=${token}`)
  console.log(
    `Vite dev UI: VITE_NATIVE_RUNTIME_WS=${socketUrl} VITE_NATIVE_RUNTIME_TOKEN=${token} npm run dev -w apps/ui`
  )

  return server
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startNativeRuntimeServer().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
