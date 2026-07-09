import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CopyClipToTrackSlotOperation } from '../src/commands/copy-clip-to-track-slot.ts';
import type { SequencerDocument } from '../src/document.ts';
import type { Parameter, ParameterDefinition } from '../src/parameter.ts';
import type { MidiClip, Pattern, Track } from '../src/project.ts';
import { Registry } from '../src/registry.ts';
import { createDefaultGrooveSettings } from '../src/groove.ts';

describe('CopyClipToTrackSlotOperation', () => {
  it('copies a clip and its pattern events into an empty slot', () => {
    const document = createTestDocument();
    const track = document.tracks.values()[0];
    const sourceClip = document.midiClips.get(track.clips[0].target);
    const sourcePattern = document.patterns.get(sourceClip.pattern);

    sourceClip.loopEnabled = false;
    sourceClip.loopStart = 1;
    sourceClip.loopLength = 2;
    sourcePattern.events.push({
      id: 'note-source',
      time: 1,
      duration: 0.5,
      type: 'trigger',
      value: { pitch: 64, velocity: 0.75 }
    });

    const operation = new CopyClipToTrackSlotOperation(
      sourceClip,
      sourcePattern,
      track.id,
      1
    );

    operation.execute(document);

    const copiedClip = document.midiClips.get(operation.clip.id);
    const copiedPattern = document.patterns.get(copiedClip.pattern);

    assert.equal(track.clips.length, 2);
    assert.equal(track.clips[1].slotIndex, 1);
    assert.equal(copiedClip.loopEnabled, sourceClip.loopEnabled);
    assert.equal(copiedClip.loopStart, sourceClip.loopStart);
    assert.equal(copiedClip.loopLength, sourceClip.loopLength);
    assert.notEqual(copiedPattern.id, sourcePattern.id);
    assert.equal(copiedPattern.events.length, 1);
    assert.notEqual(copiedPattern.events[0].id, sourcePattern.events[0].id);
    assert.deepEqual(copiedPattern.events[0].value, sourcePattern.events[0].value);

    operation.undo(document);

    assert.equal(track.clips.length, 1);
    assert.equal(document.midiClips.find(operation.clip.id), undefined);
    assert.equal(document.patterns.find(operation.pattern.id), undefined);
  });

  it('overwrites an occupied slot and restores it on undo', () => {
    const document = createTestDocument();
    const track = document.tracks.values()[0];
    const sourceClip = document.midiClips.get(track.clips[0].target);
    const sourcePattern = document.patterns.get(sourceClip.pattern);
    const originalTarget = {
      pattern: {
        id: 'pattern-target',
        name: 'Target Pattern',
        length: 4,
        events: []
      },
      clip: {
        id: 'clip-target',
        name: 'Target Clip',
        pattern: 'pattern-target',
        length: 4,
        loopEnabled: true,
        loopStart: 0,
        loopLength: 4
      },
      slot: {
        id: 'clip-slot-target',
        name: 'Target Clip',
        source: track.id,
        target: 'clip-target',
        slotIndex: 2
      }
    };

    document.patterns.add(originalTarget.pattern);
    document.midiClips.add(originalTarget.clip);
    track.clips.push(originalTarget.slot);

    const operation = new CopyClipToTrackSlotOperation(
      sourceClip,
      sourcePattern,
      track.id,
      2
    );

    operation.execute(document);

    assert.equal(document.midiClips.find(originalTarget.clip.id), undefined);
    assert.equal(track.clips.find((slot) => slot.id === originalTarget.slot.id), undefined);
    assert.equal(track.clips.find((slot) => slot.slotIndex === 2)?.target, operation.clip.id);

    operation.undo(document);

    assert.equal(document.midiClips.find(operation.clip.id), undefined);
    assert.equal(document.patterns.find(operation.pattern.id), undefined);
    assert.deepEqual(document.midiClips.get(originalTarget.clip.id), originalTarget.clip);
    assert.deepEqual(
      track.clips.find((slot) => slot.id === originalTarget.slot.id),
      originalTarget.slot
    );
  });
});

function createTestDocument(): SequencerDocument {
  const pattern: Pattern = {
    id: 'pattern-source',
    name: 'Source Pattern',
    length: 4,
    events: []
  };
  const clip: MidiClip = {
    id: 'clip-source',
    name: 'Source Clip',
    pattern: pattern.id,
    length: 4,
    loopEnabled: true,
    loopStart: 0,
    loopLength: 4
  };
  const track: Track = {
    id: 'track-source',
    name: 'Track',
    clips: [
      {
        id: 'clip-slot-source',
        name: clip.name,
        source: 'track-source',
        target: clip.id,
        slotIndex: 0
      }
    ],
    placements: [],
    mixer: {
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false
    },
    parameters: []
  };

  return {
    id: 'document-test',
    name: 'Test Document',
    bpm: 120,
    groove: createDefaultGrooveSettings(),
    timeline: {
      length: 16,
      markers: []
    },
    assets: new Registry(),
    tracks: registry(track),
    deviceInstances: new Registry(),
    midiClips: registry(clip),
    patterns: registry(pattern),
    parameterDefinitions: new Registry<ParameterDefinition>(),
    parameters: new Registry<Parameter>()
  };
}

function registry<T extends { id: string; name: string }>(entity: T): Registry<T> {
  const items = new Registry<T>();

  items.add(entity);

  return items;
}
