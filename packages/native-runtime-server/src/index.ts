import { randomBytes } from 'node:crypto'
import { NativeRuntimeServer } from './server.ts'

export * from './server.ts'
export * from './NativeRuntimeSocketSession.ts'
export * from './protocolValidation.ts'

export async function startNativeRuntimeServer(): Promise<NativeRuntimeServer> {
  const token = randomBytes(16).toString('hex')
  const server = new NativeRuntimeServer({ token })

  const handle = await server.listen()

  const baseUrl = `http://${handle.host}:${handle.port}`

  // Print launch URL for local development/kiosk startup integration.
  console.log(`${baseUrl}/?nativeToken=${token}`)

  return server
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startNativeRuntimeServer().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
