#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const statePath = resolve(root, '.tmp/native-runtime-dev.json')

let state

try {
  state = JSON.parse(await readFile(statePath, 'utf8'))
} catch {
  console.log('[native-dev] no native dev process state found.')
  process.exit(0)
}

let hadPermissionFailure = false

for (const [label, pid] of [
  ['ui', state.uiPid],
  ['native-runtime', state.runtimePid],
  ['supervisor', state.supervisorPid]
]) {
  const result = terminatePid(label, pid)

  if (result === 'permission-denied') {
    hadPermissionFailure = true
  }
}

if (hadPermissionFailure) {
  console.log('[native-dev] stop was blocked by process permissions; state file kept.')
  process.exit(1)
} else {
  await rm(statePath, { force: true })
  console.log('[native-dev] stop requested.')
}

function terminatePid(label, pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return 'skipped'
  }

  try {
    process.kill(-pid, 'SIGTERM')
    console.log(`[native-dev] sent SIGTERM to ${label} process group ${pid}.`)
    return 'signalled'
  } catch (error) {
    if (isPermissionError(error)) {
      console.log(`[native-dev] permission denied signalling ${label} process group ${pid}.`)
      return 'permission-denied'
    }
  }

  try {
    process.kill(pid, 'SIGTERM')
    console.log(`[native-dev] sent SIGTERM to ${label} process ${pid}.`)
    return 'signalled'
  } catch {
    console.log(`[native-dev] ${label} process ${pid} was not running.`)
    return 'not-running'
  }
}

function isPermissionError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EPERM'
  )
}
