import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyClipTiming,
  compileNativeClipSchedule,
  createNativeTempoMapCommand,
  createNativeTransportLoopCommand,
  nativeClipScheduleBatchCommand,
  nativeClipScheduleCommands,
  NativeClipScheduleSubmissionState,
  NATIVE_EVENT_INPUT_NODE_ID
} from '../src/native/NativeClipSchedule.ts'
import { freezePlaybackModel, type PlaybackModel } from '../src/model.ts'

describe('NativeClipSchedule', () => {
  it('lowers a one-bar MIDI clip into owned beat-domain note events', () => {
    const model = createFourQuarterNoteFixture()
    const schedule = compileNativeClipSchedule(model, {
      clipId: 'clip-1',
      generation: 3
    })

    assert.equal(schedule.clipId, 'clip-1')
    assert.equal(schedule.generation, 3)
    assert.deepEqual(schedule.events, [
      {
        kind: 'note-on',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 60,
        velocity: 0.75,
        atBeat: 0
      },
      {
        kind: 'note-off',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 60,
        atBeat: 0.5
      },
      {
        kind: 'note-on',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 62,
        velocity: 0.75,
        atBeat: 1
      },
      {
        kind: 'note-off',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 62,
        atBeat: 1.5
      },
      {
        kind: 'note-on',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 64,
        velocity: 0.75,
        atBeat: 2
      },
      {
        kind: 'note-off',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 64,
        atBeat: 2.5
      },
      {
        kind: 'note-on',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 65,
        velocity: 0.75,
        atBeat: 3
      },
      {
        kind: 'note-off',
        targetNode: NATIVE_EVENT_INPUT_NODE_ID,
        note: 65,
        atBeat: 3.5
      }
    ])
  })

  it('turns a clip schedule into generic engine scheduling commands', () => {
    const model = createFourQuarterNoteFixture()
    const schedule = compileNativeClipSchedule(model, {
      clipId: 'clip-1',
      generation: 4
    })
    const commands = nativeClipScheduleCommands(schedule, {
      timeMs: 125,
      atSample: 256
    })

    assert.equal(commands.length, 8)
    assert.deepEqual(commands[0], {
      id: 'clip-1:4:schedule:0',
      type: 'event:schedule-beat',
      clipId: 'clip-1',
      generation: 4,
      event: schedule.events[0],
      atSample: 256,
      timeMs: 125
    })
    assert.ok(commands.every((command) => command.type === 'event:schedule-beat'))
    assert.ok(commands.every((command) => command.clipId === 'clip-1'))
    assert.ok(commands.every((command) => command.generation === 4))
  })

  it('turns a clip schedule into one bounded batch command', () => {
    const model = createFourQuarterNoteFixture()
    const schedule = compileNativeClipSchedule(model, {
      clipId: 'clip-1',
      generation: 5
    })

    assert.deepEqual(
      nativeClipScheduleBatchCommand(schedule, {
        timeMs: 250,
        atSample: 512
      }),
      {
        id: 'clip-1:5:schedule-batch',
        type: 'event:schedule-beat-batch',
        clipId: 'clip-1',
        generation: 5,
        events: schedule.events,
        atSample: 512,
        timeMs: 250
      }
    )
  })

  it('creates native tempo and loop commands for the fixture', () => {
    const model = createFourQuarterNoteFixture()
    const clip = model.clips[0]

    assert.deepEqual(
      createNativeTempoMapCommand(model, {
        sampleRate: 48_000,
        timeMs: 0
      }),
      {
        id: 'native-clip-fixture:tempo-map:set',
        type: 'tempo-map:set',
        originSample: 0,
        originBeat: 0,
        bpm: 120,
        sampleRate: 48_000,
        atSample: 0,
        timeMs: 0
      }
    )

    assert.deepEqual(
      createNativeTransportLoopCommand({
        clip,
        bpm: 120,
        sampleRate: 48_000,
        timeMs: 0
      }),
      {
        id: 'clip-1:transport-loop:set',
        type: 'transport-loop:set',
        enabled: true,
        startSample: 0,
        endSample: 96_000,
        atSample: 0,
        timeMs: 0
      }
    )

    assert.deepEqual(
      createNativeTransportLoopCommand({
        clip: {
          ...clip,
          id: 'offset-clip',
          start: 8,
          loopStart: 1,
          loopLength: 2
        },
        bpm: 120,
        sampleRate: 48_000,
        timeMs: 0
      }),
      {
        id: 'offset-clip:transport-loop:set',
        type: 'transport-loop:set',
        enabled: true,
        startSample: 216_000,
        endSample: 264_000,
        atSample: 0,
        timeMs: 0
      }
    )
  })

  it('keeps the first clip timing transform as an explicit identity seam', () => {
    assert.equal(applyClipTiming(1.25, { swing: 0 }), 1.25)
  })

  it('prevents duplicate active submissions until transport stop opens the next generation', () => {
    const submissions = new NativeClipScheduleSubmissionState()

    assert.equal(submissions.begin('clip-1'), 1)
    assert.equal(submissions.begin('clip-1'), undefined)
    assert.equal(submissions.replace('clip-1'), 2)
    assert.equal(submissions.begin('clip-1'), undefined)

    submissions.stop()

    assert.equal(submissions.begin('clip-1'), 3)
  })
})

function createFourQuarterNoteFixture(): PlaybackModel {
  return freezePlaybackModel({
    id: 'native-clip-fixture',
    createdAt: 0,
    length: 4,
    tempoMap: {
      defaultBpm: 120,
      changes: [{ beat: 0, bpm: 120 }]
    },
    tracks: [
      {
        id: 'track-1',
        name: 'Track 1',
        channel: 1,
        mixer: {
          volume: 0.8,
          pan: 0,
          mute: false,
          solo: false
        },
        deviceInstanceId: 'native-instrument-1'
      }
    ],
    clips: [
      {
        id: 'clip-1',
        trackId: 'track-1',
        patternId: 'pattern-1',
        name: 'One Bar',
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
    notes: [60, 62, 64, 65].map((pitch, index) => ({
      id: `note-${index + 1}`,
      sourceNoteId: `source-note-${index + 1}`,
      trackId: 'track-1',
      clipId: 'clip-1',
      patternId: 'pattern-1',
      pitch,
      velocity: 0.75,
      beat: index,
      duration: 0.5
    })),
    automations: []
  })
}
