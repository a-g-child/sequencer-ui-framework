export type EditorKind =
  | 'piano-roll'
  | 'sample-grid'
  | 'pattern-grid'
  | 'audio-graph';

export interface EditorDefinition {
  id: EditorKind;
  name: string;
  description: string;
}
