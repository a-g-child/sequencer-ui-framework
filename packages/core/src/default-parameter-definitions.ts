export const DEFAULT_TRACK_PARAMETER_DEFINITIONS = {
  volume: {
    key: "track.volume",
    name: "Volume",
    kind: "number",
    defaultValue: 0.8,
    min: 0,
    max: 1,
    step: 0.01
  },
  pan: {
    key: "track.pan",
    name: "Pan",
    kind: "number",
    defaultValue: 0,
    min: -1,
    max: 1,
    step: 0.01
  },
  mute: {
    key: "track.mute",
    name: "Mute",
    kind: "boolean",
    defaultValue: false
  }
} as const;
