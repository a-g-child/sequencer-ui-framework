import assert from 'node:assert/strict'
import { accessSync, constants } from 'node:fs'
import { describe, it } from 'node:test'
import type { NativeExecutionPlan } from '@sequencer/audio-graph'
import {
  createRuntimeBackend,
  createDiagnosticNativeExecutionPlan,
  NativeBackend,
  WebAudioBackend,
  type RuntimeBackend
} from '../src/native/RuntimeBackend.ts'
import {
  assessNativeProjectSupport,
  compilePlaybackModelToNativePlan
} from '../src/native/PlaybackModelCompiler.ts'
import { freezePlaybackModel, type PlaybackModel } from '../src/model.ts'
import { NodeNativeRuntimeTransport } from '@sequencer/native-runtime-node'
import type {
  NativeAudioDriver,
  NativeAudioStartRequest,
  NativeRuntimeStartOptions,
  NativeRuntimeTransport
} from '../src/native/NativeRuntimeTransport.ts'

const nativeEngineCwd = new URL('../../../native-audio-engine/', import.meta.url)
  .pathname

const nativeHostPath = process.env.SEQUENCER_ENGINE_HOST_PATH?.trim()
const defaultNativeHostPath = new URL(
  '../../../native-audio-engine/target/debug/engine-host',
  import.meta.url
).pathname

function isExecutable(path: string | undefined): boolean {
  if (!path) {
    return false
  }

  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function createPlan(id = 'plan-1'): NativeExecutionPlan {
  return {
    id,
    graphId: 'graph-1',
    nodes: [],
    buffers: [],
    parameters: [],
    eventRoutes: [],
    executionGroups: [],
    latencySamples: 0
  }
}

function createNativeBackend(): NativeBackend {
  return new NativeBackend({
    transport: new NodeNativeRuntimeTransport({
      command: process.env.CARGO ?? '/Users/andrew/.cargo/bin/cargo',
      args: ['run', '-p', 'engine-host', '--', '--session-stdio'],
      cwd: nativeEngineCwd,
      shutdownTimeoutMs: 2_000
    }),
    audio: {
      driver: 'null',
      sampleRate: 48_000,
      bufferFrames: 128,
      channels: 2
    }
  })
}

describe('RuntimeBackend', () => {
  it('creates the selected runtime backend from factory options', async () => {
    const output = new FakeWebAudioOutput()
    const webBackend = createRuntimeBackend({
      kind: 'web-audio',
      webAudioOutput: output
    })
    const nativeBackend = createRuntimeBackend({
      kind: 'native',
      native: {
        transport: new FakeNativeRuntimeTransport()
      }
    })

    assert.ok(webBackend instanceof WebAudioBackend)
    assert.ok(nativeBackend instanceof NativeBackend)

    await webBackend.start()
    assert.equal(output.connected, true)
    await webBackend.dispose()
  })

  it('reports a clear failure when native is selected without a desktop transport', async () => {
    const backend = createRuntimeBackend({
      kind: 'native'
    })

    await assert.rejects(
      () => backend.start(),
      /Native playback requires the desktop host/
    )
  })

  it('passes configured native audio settings to the transport start request', async () => {
    const transport = new FakeNativeRuntimeTransport()
    const backend = new NativeBackend({
      transport,
      audio: {
        driver: 'cpal',
        sampleRate: 44_100,
        bufferFrames: 256,
        channels: 2
      }
    })

    await backend.start()

    assert.equal(transport.startedWith?.driver, 'cpal')
    assert.equal(transport.startedWith?.sampleRate, 44_100)
    assert.equal(transport.startedAudioWith?.bufferFrames, 256)

    await backend.dispose()
  })

  it('does not start an already running native transport twice', async () => {
    const transport = new FakeNativeRuntimeTransport()
    const backend = new NativeBackend({ transport })

    await backend.start()
    await backend.start()

    assert.equal(transport.startCalls, 1)
    assert.equal(transport.startAudioCalls, 1)

    await backend.dispose()
  })

  it('does not defer transport commands behind prior native command samples', async () => {
    const transport = new FakeNativeRuntimeTransport({
      snapshotSamples: [128, 256, 1_024, 512]
    })
    const backend = new NativeBackend({
      transport,
      readinessCheckDelayMs: 0
    })

    await backend.start()
    const handle = await backend.compile(createDiagnosticNativeExecutionPlan())

    await backend.activate(handle)
    backend.sendCommands([
      {
        id: 'start',
        type: 'transport:start',
        timeMs: 0,
        atSample: 256
      }
    ])
    await backend.getSnapshot()

    assert.equal(transport.activationRequestedSamples.at(-1), 1_024)
    assert.equal(transport.sentCommands.at(-1)?.type, 'transport:start')
    assert.equal(
      (transport.sentCommands.at(-1) as { atSample?: number } | undefined)?.atSample,
      256
    )

    await backend.dispose()
  })

  it('rejects native startup when audio snapshots do not advance', async () => {
    const backend = new NativeBackend({
      transport: new FakeNativeRuntimeTransport({ advanceSnapshots: false }),
      readinessCheckDelayMs: 0
    })

    await assert.rejects(
      () => backend.start(),
      /Native audio driver null did not advance after startup/
    )

    await backend.dispose()
  })

  it('compiles a PlaybackModel into a native plan with deterministic identity', () => {
    const model = createPlaybackModelFixture()

    const compilation = compilePlaybackModelToNativePlan(model)

    assert.equal(compilation.diagnostics.length, 0)
    assert.equal(compilation.support.supported, true)
    assert.equal(compilation.support.diagnostics.length, 0)
    assert.equal(compilation.plan.id.startsWith('native-plan:'), true)
    assert.equal(compilation.plan.graphId, model.id)
    assert.equal(compilation.plan.revision > 0, true)
    assert.equal(compilation.plan.nodes.length, 4)
    assert.equal(compilation.plan.nodes[0]?.descriptorId, 'sequencer.source.midi-input')
  })

  it('reports unsupported native project plans before runtime activation', () => {
    const support = assessNativeProjectSupport({
      ...createPlan('unsupported-plan'),
      nodes: [
        {
          nodeId: 'event-input',
          descriptorId: 'sequencer.source.midi-input',
          executionIndex: 0,
          inputBufferIds: [],
          outputBufferIds: [],
          parameterSlotIds: [],
          rate: 'event-rate'
        },
        {
          nodeId: 'delay',
          descriptorId: 'sequencer.processor.delay',
          executionIndex: 1,
          inputBufferIds: [],
          outputBufferIds: [],
          parameterSlotIds: [],
          rate: 'audio-rate'
        }
      ],
      eventRoutes: []
    })

    assert.equal(support.supported, false)
    assert.deepEqual(
      support.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.code),
      [
        'unsupported-audio-node',
        'missing-native-node',
        'missing-native-node',
        'missing-native-node',
        'missing-native-event-route'
      ]
    )
  })

  it('lets WebAudio compile and activate a backend-neutral handle', async () => {
    const output = new FakeWebAudioOutput()
    const backend: RuntimeBackend = new WebAudioBackend(output)
    const handle = await backend.compile(createPlan('plan-web'))

    assert.equal(handle.planId, 'plan-web')

    await backend.activate(handle)
    await backend.start()

    const snapshot = await backend.getSnapshot()

    assert.equal(snapshot.backend, 'web-audio')
    assert.equal(snapshot.running, true)

    await backend.stop()
    await backend.dispose()
    assert.equal(output.connected, false)
  })

  it('starts native audio and exposes authoritative native snapshots', async () => {
    const resolvedHostPath = nativeHostPath ?? defaultNativeHostPath
    const hostExecutable = isExecutable(nativeHostPath) || isExecutable(defaultNativeHostPath)

    if (!hostExecutable) {
      console.info(`[skip] engine-host binary not available at ${resolvedHostPath}`)
      return
    }

    const backend = createNativeBackend()

    try {
      try {
        await backend.start()
      } catch (error) {
        if (error instanceof Error && /spawn EPERM|spawn EACCES|spawn ENOENT/i.test(error.message)) {
          console.info(`[skip] unable to launch engine-host: ${error.message}`)
          return
        }

        throw error
      }

      const handle = await backend.compile(
        createDiagnosticNativeExecutionPlan({
          planId: 42,
          planRevision: 7,
          frequencyHz: 330,
          gain: 0.02
        })
      )

      assert.equal(handle.backend, 'native')
      assert.equal(handle.planId, '42')
      assert.equal(handle.revision, 7)
      assert.ok(handle.transferId > 0)

      await backend.activate(handle)
      await assert.rejects(() => backend.activate(handle), /already been consumed/)

      const snapshot = await backend.getSnapshot()

      assert.equal(snapshot.backend, 'native')
      assert.equal(snapshot.running, true)
      assert.equal(snapshot.transport.playing, false)
      assert.ok(snapshot.samplePosition > 0)
      assert.equal(backend.negotiatedCapabilities?.executionPlanVersion, 1)
      assert.equal(snapshot.native?.telemetry?.plan?.activePlanId, 42)
      assert.equal(snapshot.native?.telemetry?.plan?.activeRevision, 7)

      backend.sendCommands([
        {
          id: 'start-native-transport',
          type: 'transport:start',
          timeMs: 0,
          atSample: snapshot.transport.samplePosition
        }
      ])

      await new Promise((resolve) => setTimeout(resolve, 25))

      const playingSnapshot = await backend.getSnapshot()

      assert.equal(playingSnapshot.transport.playing, true)

      await assert.rejects(
        () => backend.compile(createPlan('native-plan')),
        /unsupported native project plan/
      )

      await backend.stop()
    } finally {
      await backend.dispose()
    }
  })
})

function createPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    id: 'project-alpha',
    createdAt: 1_700_000_000_000,
    length: 8,
    tempoMap: {
      defaultBpm: 120,
      changes: [{ beat: 0, bpm: 120 }]
    },
    tracks: [
      {
        id: 'track-1',
        name: 'Lead',
        channel: 1,
        mixer: { volume: 0.8, pan: 0 },
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
        duration: 1
      }
    ],
    automations: []
  })
}

class FakeWebAudioOutput {
  readonly id = 'fake-web-audio'
  readonly name = 'Fake Web Audio'
  connected = false
  panicked = false

  async connect(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  handleEvents(): void {}

  panic(): void {
    this.panicked = true
  }
}

class FakeNativeRuntimeTransport implements NativeRuntimeTransport {
  startedWith: NativeRuntimeStartOptions | undefined
  startedAudioWith: NativeAudioStartRequest | undefined
  startCalls = 0
  startAudioCalls = 0
  activationRequestedSamples: number[] = []
  sentCommands: EngineCommand[] = []
  private audioStarted = false
  private samplePosition = 0
  private callbackCount = 0
  private snapshotIndex = 0

  constructor(
    private readonly options: {
      readonly advanceSnapshots?: boolean
      readonly snapshotSamples?: readonly number[]
    } = {}
  ) {}

  async start(options?: NativeRuntimeStartOptions) {
    this.startCalls += 1
    this.startedWith = options

    return {
      protocolVersion: 1,
      capabilities: {
        executionPlanVersion: 1,
        eventGraphVersion: 1,
        parameterGraphVersion: 0,
        assets: false,
        telemetry: true
      },
      drivers: ['null'] as const,
      messages: []
    }
  }

  async listAudioDevices(_driver: NativeAudioDriver) {
    return []
  }

  async startAudio(request: NativeAudioStartRequest) {
    this.startAudioCalls += 1
    this.startedAudioWith = request
    this.audioStarted = true

    return {
      driver: request.driver,
      deviceId: 'null',
      deviceName: 'Null',
      sampleRate: request.sampleRate ?? 48_000,
      channels: request.channels ?? 2,
      sampleFormat: 'f32'
    }
  }

  async stopAudio() {
    this.audioStarted = false
  }

  async preparePlan(_plan: unknown) {
    return {
      transferId: 1,
      planId: 1,
      revision: 1
    }
  }

  async activatePlan(_transferId: number, requestedSample = 0) {
    this.activationRequestedSamples.push(requestedSample)

    return {
      planId: 1,
      revision: 1,
      requestedSample,
      appliedSample: requestedSample
    }
  }

  async sendCommands(commands: readonly EngineCommand[]) {
    this.sentCommands.push(...commands)

    return [
      {
        commandId: 1
      }
    ]
  }

  async getSnapshot() {
    const scriptedSample = this.options.snapshotSamples?.[this.snapshotIndex]
    this.snapshotIndex += 1

    if (scriptedSample !== undefined) {
      this.samplePosition = scriptedSample
      this.callbackCount += 1
    } else if (this.audioStarted && this.options.advanceSnapshots !== false) {
      this.samplePosition += this.startedAudioWith?.bufferFrames ?? 128
      this.callbackCount += 1
    }

    return {
      stream: {
        deviceId: 'null',
        sampleRate: this.startedAudioWith?.sampleRate ?? 48_000,
        channels: this.startedAudioWith?.channels ?? 2
      },
      transport: {
        playing: false,
        samplePosition: this.samplePosition,
        beatPosition: 0,
        loopIteration: 0
      },
      telemetry: {
        samplePosition: this.samplePosition,
        callbackCount: this.callbackCount,
        sampleRate: this.startedAudioWith?.sampleRate ?? 48_000,
        callbackFrames: this.startedAudioWith?.bufferFrames ?? 128,
        outputChannels: this.startedAudioWith?.channels ?? 2
      }
    }
  }

  async dispose() {}
}
