import type { Command } from "../command.ts";
import { addDefaultTrackParameters } from "../default-parameters.ts";
import type { SequencerDocument } from "../document.ts";
import type { BeatTime } from "../events.ts";
import {
  createMidiClip,
  createPattern,
  createPatternPlacement,
  createTrack,
  createTrackClipSlot
} from "../factory.ts";
import type { Parameter, ParameterDefinition } from "../parameter.ts";
import type {
  Pattern,
  Track,
  MidiClip
} from "../project.ts";

export class AddTrackCommand implements Command {
  readonly name = "Add Track";

  private track?: Track;
  private pattern?: Pattern;
  private midiClip?: MidiClip;
  private parameterDefinitions: ParameterDefinition[] = [];
  private parameters: Parameter[] = [];

  constructor(
    private readonly trackName = "Track 1",
    private readonly patternName = "Pattern A",
    private readonly patternLength: BeatTime = 16,
    private readonly start: BeatTime = 0
  ) {}

  execute(document: SequencerDocument): void {
    if (this.track && this.pattern && this.midiClip) {
      document.patterns.add(this.pattern);
      document.midiClips.add(this.midiClip);
      document.tracks.add(this.track);

      for (const definition of this.parameterDefinitions) {
        document.parameterDefinitions.add(definition);
      }

      for (const parameter of this.parameters) {
        document.parameters.add(parameter);
      }

      return;
    }

    const pattern = createPattern(this.patternName, this.patternLength);
    const midiClip = createMidiClip(pattern.id, this.patternName, pattern.length);
    const track = createTrack(this.trackName);
    const clipSlot = createTrackClipSlot(track.id, midiClip.id, 0, midiClip.name);
    const placement = createPatternPlacement(
      track.id,
      pattern.id,
      this.start,
      pattern.length
    );
    const existingDefinitionIds = new Set(
      document.parameterDefinitions.values().map((definition) => definition.id)
    );
    const existingParameterIds = new Set(
      document.parameters.values().map((parameter) => parameter.id)
    );

    track.clips.push(clipSlot);
    track.placements.push(placement);
    document.midiClips.add(midiClip);
    document.patterns.add(pattern);
    document.tracks.add(track);
    addDefaultTrackParameters(document, track);

    this.track = track;
    this.pattern = pattern;
    this.midiClip = midiClip;
    this.parameterDefinitions = document.parameterDefinitions
      .values()
      .filter((definition) => !existingDefinitionIds.has(definition.id));
    this.parameters = document.parameters
      .values()
      .filter((parameter) => !existingParameterIds.has(parameter.id));
  }

  undo(document: SequencerDocument): void {
    if (!this.track || !this.pattern || !this.midiClip) return;

    document.tracks.remove(this.track.id);
    document.midiClips.remove(this.midiClip.id);
    document.patterns.remove(this.pattern.id);

    for (const parameter of this.parameters) {
      document.parameters.remove(parameter.id);
    }

    for (const definition of this.parameterDefinitions) {
      document.parameterDefinitions.remove(definition.id);
    }
  }
}

export { AddTrackCommand as AddTrackOperation };
