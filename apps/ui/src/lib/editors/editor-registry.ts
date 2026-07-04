import type { EditorDefinition } from './editor-types';

export const EDITORS: EditorDefinition[] = [
  {
    id: 'piano-roll',
    name: 'Piano Roll',
    description: 'Free melodic and polyphonic note editing'
  },
  {
    id: 'sample-grid',
    name: 'Sample Grid',
    description: 'Fixed-lane sample sequencing'
  },
  {
    id: 'pattern-grid',
    name: 'Pattern Grid',
    description: 'Mono step sequencing with per-slot pitch control'
  },
  {
    id: 'audio-graph',
    name: 'Audio Graph',
    description: 'Node-based audio, modulation and routing'
  }
];
