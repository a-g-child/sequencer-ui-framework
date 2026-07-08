import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { VoiceAction } from '@sequencer/audio'
import { createNativeSchedulerWasmStub } from '@sequencer/native-scheduler-wasm'
import { NativeAudioAdapter } from '../src/native/NativeAudioAdapter.ts'
import { NativeSchedulerAdapter } from '../src/native/NativeSchedulerAdapter.ts'
import { WasmSchedulerAdapter } from '../src/native/WasmSchedulerAdapter.ts'
import { midiMessagesForPlaybackEvent } from '../src/output/MidiMessages.ts'
import { WebMidiOutput } from '../src/output/WebMidiOutput.ts'
import type { DeviceCommand } from '../src/native/schemas.ts'
import {
  createPanicDeviceCommand,
  voiceActionsToDeviceCommands
} from '../src/native/voice-action-commands.ts'
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

describe('WasmSchedulerAdapter', () => {
  it('sends model and clock state through the WASM JSON boundary', () => {
    const model = createSchedulerFixture()
    const scheduler = new WasmSchedulerAdapter(createNativeSchedulerWasmStub())

    scheduler.setModel(model)
    scheduler.start(0)

    assert.deepEqual(
      scheduler.tick({
        running: true,
        beat: 1,
        timeMs: 500,
        bpm: 120,
        sourceId: 'test'
      }),
      []
    )
    assert.deepEqual(scheduler.scheduleLookahead(0.5), [])
    assert.equal(scheduler.status.running, true)
    assert.equal(scheduler.status.currentBeat, 1)

    scheduler.stop()
    assert.equal(scheduler.status.running, false)
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

describe('MIDI output messages', () => {
  it('maps playback events to MIDI bytes', () => {
    assert.deepEqual(
      midiMessagesForPlaybackEvent({
        id: 'note-1:on',
        type: 'note:on',
        noteId: 'note-1',
        trackId: 'track-1',
        channel: 1,
        beat: 0,
        timeMs: 0,
        pitch: 60,
        velocity: 0.5
      }),
      [[0x91, 60, 64]]
    )
    assert.deepEqual(
      midiMessagesForPlaybackEvent({
        id: 'note-1:off',
        type: 'note:off',
        noteId: 'note-1',
        trackId: 'track-1',
        channel: 1,
        beat: 1,
        timeMs: 500,
        pitch: 60,
        velocity: 0
      }),
      [[0x81, 60, 0]]
    )
    assert.deepEqual(
      midiMessagesForPlaybackEvent({
        id: 'automation-1',
        type: 'automation:set',
        automationId: 'automation-1',
        parameterId: 'track-volume',
        parameterKey: 'track.volume',
        trackId: 'track-1',
        channel: 1,
        beat: 0,
        timeMs: 0,
        value: 0.25
      }),
      [[0xb1, 7, 32]]
    )
  })

  it('keeps Web MIDI unavailable instead of throwing outside browsers', async () => {
    const output = new WebMidiOutput()

    await output.connect()

    assert.equal(output.status.connected, false)
  })
})

describe('voiceActionsToDeviceCommands', () => {
  it('converts voice lifecycle actions into native device commands', () => {
    const actions: VoiceAction[] = [
      {
        type: 'voice:start',
        voiceId: 'voice-1',
        trackId: 'track-1',
        noteId: 'note-1',
        pitch: 60,
        velocity: 0.8,
        amplitude: 0.9,
        envelope: {
          attack: 0.01,
          decay: 0.15,
          sustain: 0.7,
          release: 0.2
        },
        glide: {
          startPitch: 55,
          time: 0.05
        },
        timeMs: 25
      },
      {
        type: 'voice:release',
        voiceId: 'voice-1',
        timeMs: 125
      },
      {
        type: 'voice:steal',
        voiceId: 'voice-2',
        timeMs: 130
      }
    ]

    assert.deepEqual(voiceActionsToDeviceCommands(actions, 'device-1'), [
      {
        id: 'device-1:voice-1:voice:start:25',
        type: 'voice:start',
        deviceInstanceId: 'device-1',
        sourceActionType: 'voice:start',
        timeMs: 25,
        trackId: 'track-1',
        voiceId: 'voice-1',
        noteId: 'note-1',
        pitch: 60,
        velocity: 0.8,
        amplitude: 0.9,
        envelope: {
          attack: 0.01,
          decay: 0.15,
          sustain: 0.7,
          release: 0.2
        },
        glide: {
          startPitch: 55,
          time: 0.05
        }
      },
      {
        id: 'device-1:voice-1:voice:release:125',
        type: 'voice:release',
        deviceInstanceId: 'device-1',
        sourceActionType: 'voice:release',
        timeMs: 125,
        voiceId: 'voice-1'
      },
      {
        id: 'device-1:voice-2:voice:steal:130',
        type: 'voice:steal',
        deviceInstanceId: 'device-1',
        sourceActionType: 'voice:steal',
        timeMs: 130,
        voiceId: 'voice-2'
      }
    ])
  })
})

describe('createPanicDeviceCommand', () => {
  it('creates targetable panic commands for native audio cleanup', () => {
    assert.deepEqual(
      createPanicDeviceCommand({
        reason: 'clip-stop',
        trackId: 'track-1',
        timeMs: 250
      }),
      {
        id: 'track-1:panic:clip-stop:250',
        type: 'panic',
        trackId: 'track-1',
        reason: 'clip-stop',
        timeMs: 250
      }
    )

    assert.deepEqual(
      createPanicDeviceCommand({
        reason: 'runtime-panic',
        timeMs: 500
      }),
      {
        id: 'all:panic:runtime-panic:500',
        type: 'panic',
        reason: 'runtime-panic',
        timeMs: 500
      }
    )
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
