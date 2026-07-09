import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AssetReference } from '@sequencer/assets';
import type { DeviceInstance } from '@sequencer/device';
import type { SequencerDocument } from '../src/document.ts';
import type { Parameter, ParameterDefinition } from '../src/parameter.ts';
import type { MidiClip, Pattern, Track } from '../src/project.ts';
import { Registry } from '../src/registry.ts';
import { deserializeDocument, serializeDocument } from '../src/serialization.ts';

type SamplerDeviceInstance = DeviceInstance & {
  descriptorKey: 'sampler';
  sampleSlots: Array<{
    id: string;
    name: string;
    assetId?: string;
    rootNote: number;
    gain: number;
    start: number;
    end?: number;
    loop: boolean;
    loopStart?: number;
    loopEnd?: number;
  }>;
};

describe('document serialization', () => {
  it('round-trips assets, device instances, and matrix clip slots', () => {
    const pattern: Pattern = {
      id: 'pattern-1',
      name: 'Pattern 1',
      length: 4,
      events: []
    };
    const clip: MidiClip = {
      id: 'clip-1',
      name: 'Clip 1',
      pattern: pattern.id,
      length: 4,
      loopEnabled: true,
      loopStart: 0,
      loopLength: 4
    };
    const asset: AssetReference = {
      id: 'asset-kick',
      kind: 'audio-sample',
      name: 'Kick.wav',
      uri: 'blob:local-kick',
      mimeType: 'audio/wav',
      durationSeconds: 0.42,
      sampleRate: 48000,
      channels: 1
    };
    const sampler: SamplerDeviceInstance = {
      id: 'device-sampler',
      descriptorKey: 'sampler',
      name: 'Sampler',
      parameterValues: {
        mode: 'multi',
        volume: 0.7
      },
      sampleSlots: [
        {
          id: 'slot-kick',
          name: 'Kick',
          assetId: asset.id,
          rootNote: 36,
          gain: 0.85,
          start: 0.01,
          end: 0.38,
          loop: true,
          loopStart: 0.04,
          loopEnd: 0.32
        }
      ]
    };
    const track: Track = {
      id: 'track-1',
      name: 'Track 1',
      deviceId: sampler.id,
      mixer: {
        volume: 0.64,
        pan: -0.25,
        mute: false,
        solo: true
      },
      clips: [
        {
          id: 'clip-slot-1',
          name: clip.name,
          source: 'track-1',
          target: clip.id,
          slotIndex: 3
        }
      ],
      placements: [],
      parameters: []
    };
    const document: SequencerDocument = {
      id: 'document-1',
      name: 'Saved Groovebox',
      bpm: 120,
      timeline: {
        length: 16,
        markers: []
      },
      assets: registry(asset),
      tracks: registry(track),
      deviceInstances: registry(sampler),
      midiClips: registry(clip),
      patterns: registry(pattern),
      parameterDefinitions: new Registry<ParameterDefinition>(),
      parameters: new Registry<Parameter>()
    };

    const restored = deserializeDocument(serializeDocument(document));
    const restoredTrack = restored.tracks.get(track.id);
    const restoredSampler = restored.deviceInstances.get(
      sampler.id
    ) as SamplerDeviceInstance;

    assert.deepEqual(restored.assets.get(asset.id), asset);
    assert.equal(restoredTrack.deviceId, sampler.id);
    assert.deepEqual(restoredTrack.mixer, track.mixer);
    assert.equal(restoredTrack.clips[0].slotIndex, 3);
    assert.deepEqual(restoredSampler.parameterValues, sampler.parameterValues);
    assert.deepEqual(restoredSampler.sampleSlots, sampler.sampleSlots);
  });

  it('adds default mixer state when loading older documents', () => {
    const serialized = JSON.stringify({
      id: 'document-legacy',
      name: 'Legacy',
      bpm: 120,
      timeline: { length: 16, markers: [] },
      tracks: [
        {
          id: 'track-legacy',
          name: 'Track',
          clips: [],
          placements: [],
          parameters: []
        }
      ],
      patterns: [],
      parameterDefinitions: [],
      parameters: []
    });

    const restored = deserializeDocument(serialized);

    assert.deepEqual(restored.tracks.get('track-legacy').mixer, {
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false
    });
  });
});

function registry<T extends { id: string; name: string }>(entity: T): Registry<T> {
  const items = new Registry<T>();

  items.add(entity);

  return items;
}
