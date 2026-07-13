import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDocument } from '@sequencer/core'
import { PlaybackModelBuilder } from '../src/builder.ts'

describe('PlaybackModelBuilder', () => {
  it('derives swung note duration from grooved note-on and note-off beats', () => {
    const document = createDocument('Groove Fixture')
    const pattern = document.patterns.values()[0]

    document.groove = {
      enabled: true,
      amount: 1,
      division: 0.25
    }
    pattern.events = [
      {
        id: 'note-1',
        type: 'trigger',
        time: 0.25,
        duration: 0.25,
        value: {
          pitch: 60,
          velocity: 0.8
        }
      }
    ]

    const model = new PlaybackModelBuilder().build(document, 120)
    const note = model.notes.find((candidate) => candidate.sourceNoteId === 'note-1')

    assert.equal(note?.beat, 0.375)
    assert.equal(note?.duration, 0.125)
  })
})
