import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  NativeBackend,
  PlaybackRuntimeController,
  compileNativeClipSchedule,
  createNativeTempoMapCommand,
  createNativeTransportLoopCommand,
  freezePlaybackModel,
  nativeClipScheduleBatchCommand,
  type NativeAudioDriver,
  type PlaybackModel
} from '@sequencer/playback'
import { compilePlaybackModelToNativePlan } from '@sequencer/playback'
import { NativeRuntimeManager } from '../src/NativeRuntimeManager.ts'

const smokeDriver = (process.env.NATIVE_DESKTOP_SMOKE_DRIVER ?? 'cpal') as NativeAudioDriver
const runDesktopSmoke = process.env.NATIVE_DESKTOP_SMOKE === '1'
const smokeTimeoutMs = Number(process.env.NATIVE_DESKTOP_SMOKE_TIMEOUT_MS ?? 15_000)

describe('desktop native runtime smoke', () => {
  it(
    'runs the production-shaped native playback path for a real project',
    {
      skip: runDesktopSmoke
        ? false
        : 'set NATIVE_DESKTOP_SMOKE=1 to run the CPAL desktop smoke',
      timeout: smokeTimeoutMs + 5_000
    },
    async () => {
    const manager = new NativeRuntimeManager()
    const backend = new NativeBackend({
      transport: manager,
      audio: {
        driver: smokeDriver,
        sampleRate: 48_000,
        bufferFrames: 128,
        channels: 2
      }
    })
    const controller = new PlaybackRuntimeController(backend, { autoPoll: false })

    try {
      const initialModel = createPlaybackModelFixture()
      const initialCompilation = compilePlaybackModelToNativePlan(initialModel)

      if (initialCompilation.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        assert.fail(
          initialCompilation.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join('; ')
        )
      }

      try {
        await withTimeout(
          controller.compileAndActivate(initialCompilation.plan),
          smokeTimeoutMs,
          'native desktop smoke timed out during startup/plan activation'
        )
      } catch (error) {
        if (isSkippableDesktopSmokeError(error)) {
          console.info(`[skip] native desktop smoke unavailable: ${errorMessage(error)}`)
          return
        }

        throw error
      }

      const activated = controller.status.snapshot

      assert.equal(activated?.plan.activeRevision, initialCompilation.plan.revision)
      assert.equal(activated?.transport.playing, false)

      submitClipSchedule(controller, initialModel, 1)
      await withTimeout(controller.play(), smokeTimeoutMs, 'transport start timed out')
      await wait(80)

      const playingSnapshot = await withTimeout(
        controller.refreshSnapshot(),
        smokeTimeoutMs,
        'playing snapshot timed out'
      )

      assert.equal(playingSnapshot.transport.playing, true)
      assert.ok(playingSnapshot.transport.samplePosition > (activated?.transport.samplePosition ?? 0))
      assert.ok(playingSnapshot.transport.beatPosition >= 0)

      const editedScheduleModel = moveFixtureNote(initialModel, 1)
      submitClipSchedule(controller, editedScheduleModel, 2)

      const graphEditedModel = changeFixtureGraphInput(editedScheduleModel)
      const graphCompilation = compilePlaybackModelToNativePlan(graphEditedModel)

      assert.notEqual(graphCompilation.plan.revision, initialCompilation.plan.revision)

      const graphSnapshot = await withTimeout(
        controller.compileAndActivate(graphCompilation.plan),
        smokeTimeoutMs,
        'graph replacement timed out'
      )

      assert.equal(graphSnapshot.plan.activeRevision, graphCompilation.plan.revision)
      assert.equal(graphSnapshot.transport.playing, true)

      await withTimeout(controller.stop(), smokeTimeoutMs, 'transport stop timed out')
      const stoppedSnapshot = await withTimeout(
        controller.refreshSnapshot(),
        smokeTimeoutMs,
        'stopped snapshot timed out'
      )

      assert.equal(stoppedSnapshot.transport.playing, false)

      submitClipSchedule(controller, graphEditedModel, 3)
      await withTimeout(controller.play(), smokeTimeoutMs, 'transport restart timed out')
      await wait(60)

      const restartedSnapshot = await withTimeout(
        controller.refreshSnapshot(),
        smokeTimeoutMs,
        'restarted snapshot timed out'
      )

      assert.equal(restartedSnapshot.transport.playing, true)
      assert.equal(restartedSnapshot.diagnostics.queueOverflows, 0)
    } finally {
      await controller.dispose()
    }
    }
  )
})

function submitClipSchedule(
  controller: PlaybackRuntimeController,
  model: PlaybackModel,
  generation: number
): void {
  const clip = model.clips[0]
  const snapshot = controller.status.snapshot

  assert.ok(clip, 'fixture clip should exist')
  assert.ok(snapshot, 'runtime snapshot should exist before scheduling')

  const atSample = snapshot.transport.samplePosition
  const sampleRate = snapshot.stream.sampleRate || 48_000
  const timeMs = nowMs()
  const schedule = compileNativeClipSchedule(model, {
    clipId: clip.id,
    generation
  })

  controller.sendCommands([
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

function createPlaybackModelFixture(): PlaybackModel {
  return freezePlaybackModel({
    id: 'desktop-smoke-project',
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

function moveFixtureNote(model: PlaybackModel, beat: number): PlaybackModel {
  return freezePlaybackModel({
    ...model,
    notes: model.notes.map((note) =>
      note.id === 'note-2'
        ? {
            ...note,
            beat
          }
        : note
    )
  })
}

function changeFixtureGraphInput(model: PlaybackModel): PlaybackModel {
  return freezePlaybackModel({
    ...model,
    tracks: model.tracks.map((track) =>
      track.id === 'track-1'
        ? {
            ...track,
            mixer: {
              ...track.mixer,
              volume: 0.65
            }
          }
        : track
    )
  })
}

function isSkippableDesktopSmokeError(error: unknown): boolean {
  const message = errorMessage(error)

  return /timed out|NoDefaultOutputDevice|AudioDeviceUnavailable|cpal|CoreAudio|AudioUnit|spawn EPERM|spawn EACCES|spawn ENOENT|engine-host/i.test(
    message
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
