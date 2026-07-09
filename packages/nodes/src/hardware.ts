import type { NodeDescriptor } from './types.ts';

export const CV_OUTPUT_NODE: NodeDescriptor = {
  id: 'sequencer.hardware.cv-output',
  type: 'cv-output',
  name: 'CV Output',
  category: 'hardware',
  capabilities: ['hardware-io'],
  ports: [{ id: 'control-in', name: 'Control In', kind: 'control', direction: 'input' }]
};

export const GATE_OUTPUT_NODE: NodeDescriptor = {
  id: 'sequencer.hardware.gate-output',
  type: 'gate-output',
  name: 'Gate Output',
  category: 'hardware',
  capabilities: ['hardware-io'],
  ports: [{ id: 'gate-in', name: 'Gate In', kind: 'gate', direction: 'input' }]
};

export const GPIO_NODE: NodeDescriptor = {
  id: 'sequencer.hardware.gpio',
  type: 'gpio',
  name: 'GPIO',
  category: 'hardware',
  capabilities: ['hardware-io'],
  ports: [
    { id: 'gpio-in', name: 'GPIO In', kind: 'gpio', direction: 'input' },
    { id: 'gpio-out', name: 'GPIO Out', kind: 'gpio', direction: 'output' }
  ]
};

export const SERIAL_NODE: NodeDescriptor = {
  id: 'sequencer.hardware.serial',
  type: 'serial',
  name: 'Serial',
  category: 'hardware',
  capabilities: ['hardware-io'],
  ports: [
    { id: 'serial-in', name: 'Serial In', kind: 'serial', direction: 'input' },
    { id: 'serial-out', name: 'Serial Out', kind: 'serial', direction: 'output' }
  ]
};

export const NETWORK_NODE: NodeDescriptor = {
  id: 'sequencer.hardware.network',
  type: 'network',
  name: 'Network',
  category: 'hardware',
  capabilities: ['hardware-io'],
  ports: [
    { id: 'network-in', name: 'Network In', kind: 'network', direction: 'input' },
    { id: 'network-out', name: 'Network Out', kind: 'network', direction: 'output' }
  ]
};

export const LIGHTING_NODE: NodeDescriptor = {
  id: 'sequencer.hardware.lighting',
  type: 'lighting',
  name: 'Lighting',
  category: 'hardware',
  capabilities: ['hardware-io'],
  ports: [{ id: 'control-in', name: 'Control In', kind: 'control', direction: 'input' }]
};

export const DEVICE_OUTPUT_NODE: NodeDescriptor = {
  id: 'sequencer.output.device-out',
  type: 'device-out',
  name: 'Device Out',
  category: 'output',
  capabilities: ['routing'],
  ports: [
    { id: 'audio-in', name: 'Audio In', kind: 'audio', direction: 'input' },
    { id: 'midi-in', name: 'MIDI In', kind: 'midi', direction: 'input' },
    { id: 'control-in', name: 'Control In', kind: 'control', direction: 'input' }
  ]
};

export const HARDWARE_NODE_DESCRIPTORS: readonly NodeDescriptor[] = [
  CV_OUTPUT_NODE,
  GATE_OUTPUT_NODE,
  GPIO_NODE,
  SERIAL_NODE,
  NETWORK_NODE,
  LIGHTING_NODE,
  DEVICE_OUTPUT_NODE
];
