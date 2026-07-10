import type { DeviceDescriptor } from '../device.ts';

export const LFO_DESCRIPTOR: DeviceDescriptor = {
  id: 'device.lfo',
  key: 'lfo',
  name: 'LFO',
  manufacturer: 'Sequencer',
  capabilities: ['midi-effect', 'modulation-source'],
  ports: [
    { id: 'midi-in', name: 'MIDI In', kind: 'midi-in' },
    { id: 'midi-out', name: 'MIDI Out', kind: 'midi-out' },
    { id: 'control-out', name: 'Control Out', kind: 'control-out' }
  ],
  parameters: [
    {
      id: 'waveform',
      key: 'waveform',
      name: 'Wave',
      kind: 'choice',
      defaultValue: 'sine',
      options: [
        { label: 'Sine', value: 'sine' },
        { label: 'Triangle', value: 'triangle' },
        { label: 'Saw Up', value: 'saw-up' },
        { label: 'Saw Down', value: 'saw-down' },
        { label: 'Square', value: 'square' },
        { label: 'S&H', value: 'sample-hold' }
      ]
    },
    {
      id: 'rate-mode',
      key: 'rateMode',
      name: 'Mode',
      kind: 'choice',
      defaultValue: 'free',
      options: [
        { label: 'Free', value: 'free' },
        { label: 'Sync', value: 'sync' }
      ]
    },
    {
      id: 'rate',
      key: 'rate',
      name: 'Rate',
      kind: 'number',
      defaultValue: 0.5,
      min: 0.01,
      max: 20,
      step: 0.01,
      unit: 'Hz'
    },
    {
      id: 'sync-division',
      key: 'syncDivision',
      name: 'Division',
      kind: 'choice',
      defaultValue: '1/4',
      options: [
        { label: '4 Bar', value: '4/1' },
        { label: '2 Bar', value: '2/1' },
        { label: '1 Bar', value: '1/1' },
        { label: '1/2', value: '1/2' },
        { label: '1/2.', value: '1/2.' },
        { label: '1/2T', value: '1/2T' },
        { label: '1/4', value: '1/4' },
        { label: '1/4.', value: '1/4.' },
        { label: '1/4T', value: '1/4T' },
        { label: '1/8', value: '1/8' },
        { label: '1/8.', value: '1/8.' },
        { label: '1/8T', value: '1/8T' },
        { label: '1/16', value: '1/16' },
        { label: '1/16.', value: '1/16.' },
        { label: '1/16T', value: '1/16T' },
        { label: '1/32', value: '1/32' }
      ]
    },
    {
      id: 'depth',
      key: 'depth',
      name: 'Depth',
      kind: 'number',
      defaultValue: 0.25,
      min: 0,
      max: 1,
      step: 0.01
    },
    {
      id: 'phase',
      key: 'phase',
      name: 'Phase',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: 'deg'
    },
    {
      id: 'target-device-id',
      key: 'targetDeviceId',
      name: 'Device',
      kind: 'text',
      defaultValue: ''
    },
    {
      id: 'target-parameter-key',
      key: 'targetParameterKey',
      name: 'Target',
      kind: 'text',
      defaultValue: ''
    }
  ]
};
