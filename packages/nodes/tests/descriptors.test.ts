import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_NODE_DESCRIPTORS,
  type NodeDescriptor
} from '../src/index.ts';

test('defines a backend-neutral node vocabulary', () => {
  const ids = new Set(DEFAULT_NODE_DESCRIPTORS.map((descriptor) => descriptor.id));

  assert.equal(ids.size, DEFAULT_NODE_DESCRIPTORS.length);
  assert.ok(ids.has('sequencer.source.oscillator'));
  assert.ok(ids.has('sequencer.source.sample-player'));
  assert.ok(ids.has('sequencer.midi.transpose'));
  assert.ok(ids.has('sequencer.control.lfo'));
  assert.ok(ids.has('sequencer.converter.midi-note-to-frequency'));
  assert.ok(ids.has('sequencer.converter.mono-to-stereo'));
  assert.ok(ids.has('sequencer.hardware.cv-output'));
});

test('each node exposes typed ports', () => {
  for (const descriptor of DEFAULT_NODE_DESCRIPTORS) {
    assertNodeDescriptor(descriptor);
  }
});

function assertNodeDescriptor(descriptor: NodeDescriptor): void {
  assert.equal(typeof descriptor.id, 'string');
  assert.equal(typeof descriptor.type, 'string');
  assert.equal(typeof descriptor.name, 'string');
  assert.ok(descriptor.ports.length > 0);

  for (const port of descriptor.ports) {
    assert.equal(typeof port.id, 'string');
    assert.equal(typeof port.name, 'string');
    assert.ok(port.direction === 'input' || port.direction === 'output');
    assert.equal(typeof port.kind, 'string');
  }
}
