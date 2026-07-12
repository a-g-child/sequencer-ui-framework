import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, it } from 'node:test'
import { NativeRuntimeServer } from '../src/server.ts'

describe('NativeRuntimeServer static UI', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop()

      if (!directory) {
        break
      }

      await rm(directory, { recursive: true, force: true })
    }
  })

  it('serves index.html from root path', async () => {
    const uiDirectory = await createUiFixture(tempDirs)
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      uiDirectory
    })

    const handle = await server.listen()
    const response = await httpRequest(`http://${handle.host}:${handle.port}/`)

    assert.equal(response.status, 200)
    assert.equal(response.contentType, 'text/html; charset=utf-8')
    assert.equal(response.body.includes('Sequencer UI'), true)

    await server.close()
  })

  it('serves static assets under /assets', async () => {
    const uiDirectory = await createUiFixture(tempDirs)
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      uiDirectory
    })

    const handle = await server.listen()
    const response = await httpRequest(
      `http://${handle.host}:${handle.port}/assets/app.js`
    )

    assert.equal(response.status, 200)
    assert.equal(response.contentType, 'application/javascript; charset=utf-8')
    assert.equal(response.body.trim(), 'console.log("app")')

    await server.close()
  })

  it('returns 404 for missing assets', async () => {
    const uiDirectory = await createUiFixture(tempDirs)
    const server = new NativeRuntimeServer({
      host: '127.0.0.1',
      port: 0,
      uiDirectory
    })

    const handle = await server.listen()
    const response = await httpRequest(
      `http://${handle.host}:${handle.port}/assets/missing.js`
    )

    assert.equal(response.status, 404)

    await server.close()
  })
})

async function createUiFixture(tempDirs: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sequencer-ui-'))
  tempDirs.push(root)

  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><body><h1>Sequencer UI</h1></body></html>',
    'utf8'
  )
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("app")\n', 'utf8')

  return root
}

function httpRequest(url: string): Promise<{
  status: number
  body: string
  contentType: string
}> {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(async (response) => {
        resolve({
          status: response.status,
          body: await response.text(),
          contentType: response.headers.get('content-type') ?? ''
        })
      })
      .catch((error) => {
        reject(error)
      })
  })
}
