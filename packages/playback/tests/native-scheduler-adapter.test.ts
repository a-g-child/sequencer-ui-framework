import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NativeAudioAdapter } from '../src/native/NativeAudioAdapter.ts'
import { NativeSchedulerAdapter } from '../src/native/NativeSchedulerAdapter.ts'
import type { DeviceCommand } from '../src/native/schemas.ts'
import { freezePlaybackModel, type PlaybackModel } from '../src/model.ts'
import {
  TypeScriptScheduler,
  type Scheduler
} from '../src/scheduler.ts'

describe('NativeSchedulerAdapter', () => {
  it('emits the same playback events as the TypeScript scheduler', () => {
    const model = createSchedulerFixture()
    const options = { automationSampleIntervalBeats: 0.5 }
    const reference = new TypeScriptScheduler(options)
    const adapter = new NativeSchedulerAdapter(options)

    assert.deepEqual(
      collectEvents(reference, model),
      collectEvents(adapter, model)
    )
  })
})

describe('NativeAudioAdapter', () => {
  it('acknowledges device commands without executing DSP', () => {
    const adapter = new NativeAudioAdapter()
    const commands: DeviceCommand[] = [
      {
        id: 'command-1',
        type: 'voice:start',
        deviceInstanceId: 'device-1',
        trackId: 'track-1',
        voiceId: 'voice-1',
        noteId: 'note-1',
        pitch: 60,
        velocity: 0.8,
        timeMs: 0
      },
      {
        id: 'command-2',
        type: 'panic',
        deviceInstanceId: 'device-1',
        timeMs: 10
      }
    ]

    const acks = adapter.handleCommands(commands)

    assert.deepEqual(acks, [
      { commandId: 'command-1', type: 'voice:start', accepted: true },
      { commandId: 'command-2', type: 'panic', accepted: true }
    ])
    assert.equal(adapter.status.receivedCommandCount, 2)
    assert.equal(adapter.status.lastCommand, commands[1])
    assert.equal(adapter.acks().length, 2)
  })
})

function collectEvents(scheduler: Scheduler, model: PlaybackModel) {
  scheduler.setModel(model)
  scheduler.start(0)

  const firstBatch = scheduler.tick({
    running: true,
    beat: 0,
    timeMs: 0,
    bpm: 120,
    sourceId: 'test'
  })
  const secondBatch = scheduler.tick({
    running: true,
    beat: 1,
    timeMs: 500,
    bpm: 120,
    sourceId: 'test'
  })
  scheduler.seek(2)
  const thirdBatch = scheduler.tick({
    running: true,
    beat: 2,
    timeMs: 1000,
    bpm: 120,
    sourceId: 'test'
  })

  return [...firstBatch, ...secondBatch, ...thirdBatch]
}

function createSchedulerFixture(): PlaybackModel {
  return freezePlaybackModel({
    id: 'playback-fixture',
    createdAt: 0,
    length: 4,
    tempoMap: {
      defaultBpm: 120,
      changes: [{ beat: 0, bpm: 120 }]
    },
    tracks: [
      {
        id: 'track-1',
        name: 'Bass',
        channel: 1,
        deviceInstanceId: 'device-1'
      }
    ],
    clips: [
      {
        id: 'clip-1',
        trackId: 'track-1',
        patternId: 'pattern-1',
        name: 'Loop',
        start: 0,
        length: 4,
        loop: true,
        loopStart: 0,
        loopLength: 2,
        sourceStart: 0,
        sourceLength: 2,
        loopIndex: 0
      }
    ],
    notes: [
      {
        id: 'note-1',
        sourceNoteId: 'source-note-1',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        pitch: 60,
        velocity: 0.75,
        beat: 0,
        duration: 0.5
      },
      {
        id: 'note-2',
        sourceNoteId: 'source-note-2',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        pitch: 67,
        velocity: 0.6,
        beat: 1,
        duration: 0.5
      }
    ],
    automations: [
      {
        id: 'automation-1',
        sourceEventId: 'source-automation-1',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        parameterId: 'device:device-1:cutoff',
        parameterKey: 'cutoff',
        deviceInstanceId: 'device-1',
        value: 400,
        beat: 0
      },
      {
        id: 'automation-2',
        sourceEventId: 'source-automation-2',
        trackId: 'track-1',
        clipId: 'clip-1',
        patternId: 'pattern-1',
        parameterId: 'device:device-1:cutoff',
        parameterKey: 'cutoff',
        deviceInstanceId: 'device-1',
        value: 1200,
        beat: 1
      }
    ]
  })
}
