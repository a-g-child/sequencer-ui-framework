#!/usr/bin/env node
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const statePath = resolve(root, '.tmp/native-runtime-dev.json')
const uiPort = process.env.NATIVE_RUNTIME_UI_PORT ?? '5173'

let shuttingDown = false
let runtimeProcess
let uiProcess

await mkdir(dirname(statePath), { recursive: true })

runtimeProcess = spawn(
  process.execPath,
  ['--experimental-transform-types', 'src/index.ts'],
  {
    cwd: resolve(root, 'packages/native-runtime-server'),
    env: {
      ...process.env,
      NATIVE_RUNTIME_PORT: process.env.NATIVE_RUNTIME_PORT ?? '0',
      NATIVE_RUNTIME_UI_PORT: uiPort
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }
)

runtimeProcess.stdout.setEncoding('utf8')
runtimeProcess.stderr.setEncoding('utf8')

let runtimeReady = false
let runtimeOutput = ''
let uiUrl

runtimeProcess.stdout.on('data', (chunk) => {
  process.stdout.write(prefixLines('[native-runtime] ', chunk))
  runtimeOutput += chunk

  if (!runtimeReady) {
    maybeStartUi()
  }
})

runtimeProcess.stderr.on('data', (chunk) => {
  process.stderr.write(prefixLines('[native-runtime] ', chunk))
})

runtimeProcess.once('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(
      `[native-dev] native runtime exited before shutdown: code=${code ?? 'null'} signal=${signal ?? 'null'}`
    )
    void shutdown(1)
  }
})

process.on('SIGINT', () => {
  void shutdown(130)
})

process.on('SIGTERM', () => {
  void shutdown(143)
})

function maybeStartUi() {
  const launch = parseLaunchDetails(runtimeOutput)

  if (!launch) {
    return
  }

  runtimeReady = true
  uiUrl = `http://localhost:${uiPort}/?nativeToken=${launch.token}`

  uiProcess = spawn('npm', ['run', 'dev', '-w', 'apps/ui', '--', '--port', uiPort], {
    cwd: root,
    env: {
      ...process.env,
      VITE_PLAYBACK_BACKEND: 'native',
      VITE_NATIVE_RUNTIME_WS: launch.socketUrl,
      VITE_NATIVE_RUNTIME_TOKEN: launch.token
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  uiProcess.stdout.setEncoding('utf8')
  uiProcess.stderr.setEncoding('utf8')
  uiProcess.stdout.on('data', (chunk) => {
    process.stdout.write(prefixLines('[ui] ', chunk))
  })
  uiProcess.stderr.on('data', (chunk) => {
    process.stderr.write(prefixLines('[ui] ', chunk))
  })
  uiProcess.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[native-dev] UI exited before shutdown: code=${code ?? 'null'} signal=${signal ?? 'null'}`
      )
      void shutdown(1)
    }
  })

  void writeState({
    startedAt: new Date().toISOString(),
    supervisorPid: process.pid,
    runtimePid: runtimeProcess.pid,
    uiPid: uiProcess.pid,
    uiUrl,
    socketUrl: launch.socketUrl
  })

  console.log('')
  console.log(`[native-dev] UI: ${uiUrl}`)
  console.log('[native-dev] Stop with Ctrl-C or: npm run dev:native:stop')
  console.log('')
}

async function writeState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  console.log('\n[native-dev] shutting down native dev processes...')

  terminateProcess(uiProcess)
  terminateProcess(runtimeProcess)

  await waitForExit(uiProcess, 2_000)
  await waitForExit(runtimeProcess, 2_000)
  terminateProcess(uiProcess, 'SIGKILL')
  terminateProcess(runtimeProcess, 'SIGKILL')

  await rm(statePath, { force: true })
  process.exit(exitCode)
}

function parseLaunchDetails(output) {
  const socketMatch = output.match(/VITE_NATIVE_RUNTIME_WS=([^\s]+)/)
  const tokenMatch = output.match(/VITE_NATIVE_RUNTIME_TOKEN=([^\s]+)/)

  if (!socketMatch || !tokenMatch) {
    return undefined
  }

  return {
    socketUrl: socketMatch[1],
    token: tokenMatch[1]
  }
}

function prefixLines(prefix, chunk) {
  return String(chunk)
    .split(/(\r?\n)/)
    .map((part) => (part === '\n' || part === '\r\n' || part.length === 0 ? part : `${prefix}${part}`))
    .join('')
}

function terminateProcess(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Process is already gone.
    }
  }
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
