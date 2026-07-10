import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ARPEGGIATOR_MIDI_GRAPH } from '@sequencer/audio-graph';
import { ARPEGGIATOR_DESCRIPTOR } from '../src/descriptors/arpeggiator.ts';
import { ArpeggiatorFactory } from '../src/factories/arpeggiator.ts';
import { getRuntimeParameter } from '../src/parameter-runtime.ts';

describe('Arpeggiator graph preset', () => {
  it('advertises the graph document on the descriptor', () => {
    assert.equal(ARPEGGIATOR_DESCRIPTOR.graphPreset, ARPEGGIATOR_MIDI_GRAPH);
  });

  it('builds a pure MIDI runtime graph and arpeggiates note events', () => {
    const device = new ArpeggiatorFactory().create({
      id: 'arp-1',
      descriptorKey: ARPEGGIATOR_DESCRIPTOR.key,
      name: 'Arpeggiator',
      parameterValues: {
        octaveRange: 2
      }
    });

    assert.equal(device.runtimeGraph?.document.id, ARPEGGIATOR_MIDI_GRAPH.id);
    assert.equal(device.runtimeGraph?.nodes.length, 3);
    assert.equal(device.runtimeGraph?.connections.length, 2);
    assert.deepEqual(device.runtimeGraph?.diagnostics, []);
    assert.deepEqual(device.runtimeGraph?.executionOrder, [
      'midi-in',
      'arpeggiator',
      'midi-out'
    ]);
    assert.equal(getRuntimeParameter(device.parameters, 'octaveRange')?.value, 2);

    device.processEvents([
      {
        id: 'event-1:on',
        type: 'note:on',
        noteId: 'note-1',
        pitch: 60,
        velocity: 0.75,
        beat: 0,
        timeMs: 100,
        duration: 1,
        durationMs: 1000
      }
    ]);

    assert.deepEqual(
      device.consumePlaybackEvents().map((event) => ({
        type: event.type,
        noteId: event.noteId,
        pitch: event.pitch,
        beat: event.beat,
        timeMs: event.timeMs
      })),
      [
        {
          type: 'note:on',
          noteId: 'note-1:arp-0',
          pitch: 60,
          beat: 0,
          timeMs: 100
        },
        {
          type: 'note:off',
          noteId: 'note-1:arp-0',
          pitch: 60,
          beat: 0.2,
          timeMs: 300
        },
        {
          type: 'note:on',
          noteId: 'note-1:arp-1',
          pitch: 72,
          beat: 0.25,
          timeMs: 350
        },
        {
          type: 'note:off',
          noteId: 'note-1:arp-1',
          pitch: 72,
          beat: 0.45,
          timeMs: 550
        },
        {
          type: 'note:on',
          noteId: 'note-1:arp-2',
          pitch: 60,
          beat: 0.5,
          timeMs: 600
        },
        {
          type: 'note:off',
          noteId: 'note-1:arp-2',
          pitch: 60,
          beat: 0.7,
          timeMs: 800
        },
        {
          type: 'note:on',
          noteId: 'note-1:arp-3',
          pitch: 72,
          beat: 0.75,
          timeMs: 850
        },
        {
          type: 'note:off',
          noteId: 'note-1:arp-3',
          pitch: 72,
          beat: 0.95,
          timeMs: 1050
        }
      ]
    );
    assert.deepEqual(device.getDiagnostics().graph, {
      presetId: ARPEGGIATOR_MIDI_GRAPH.id,
      nodeCount: 3,
      connectionCount: 2,
      latencySamples: 0,
      executionOrder: ['midi-in', 'arpeggiator', 'midi-out'],
      diagnostics: [],
      nodeDiagnostics: [
        {
          nodeId: 'midi-in',
          descriptorId: 'sequencer.source.midi-input',
          executionIndex: 0,
          latencySamples: 0
        },
        {
          nodeId: 'arpeggiator',
          descriptorId: 'sequencer.midi.arpeggiator',
          executionIndex: 1,
          latencySamples: 0
        },
        {
          nodeId: 'midi-out',
          descriptorId: 'sequencer.output.midi-out',
          executionIndex: 2,
          latencySamples: 0
        }
      ]
    });
  });

  it('uses rate to space arpeggiated steps', () => {
    const device = new ArpeggiatorFactory().create({
      id: 'arp-1',
      descriptorKey: ARPEGGIATOR_DESCRIPTOR.key,
      name: 'Arpeggiator',
      parameterValues: {
        octaveRange: 2,
        rate: '1/8'
      }
    });

    device.processEvents([
      {
        id: 'event-1:on',
        type: 'note:on',
        noteId: 'note-1',
        pitch: 60,
        velocity: 0.75,
        beat: 0,
        timeMs: 100,
        duration: 1,
        durationMs: 1000
      }
    ]);

    assert.deepEqual(
      device.consumePlaybackEvents()
        .filter((event) => event.type === 'note:on')
        .map((event) => ({
          pitch: event.pitch,
          beat: event.beat,
          timeMs: event.timeMs
        })),
      [
        { pitch: 60, beat: 0, timeMs: 100 },
        { pitch: 72, beat: 0.5, timeMs: 600 }
      ]
    );
  });
});
