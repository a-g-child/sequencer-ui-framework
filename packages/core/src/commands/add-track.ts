import type { Command } from "../command";
import { addDefaultTrackParameters } from "../default-parameters";
import type { SequencerDocument } from "../document";
import type { BeatTime } from "../events";
import {
  createPattern,
  createPatternPlacement,
  createTrack
} from "../factory";
import type { Parameter, ParameterDefinition } from "../parameter";
import type {
  Pattern,
  Track
} from "../project";

export class AddTrackCommand implements Command {
  readonly name = "Add Track";

  private track?: Track;
  private pattern?: Pattern;
  private parameterDefinitions: ParameterDefinition[] = [];
  private parameters: Parameter[] = [];

  constructor(
    private readonly trackName = "Track 1",
    private readonly patternName = "Pattern A",
    private readonly patternLength: BeatTime = 16,
    private readonly start: BeatTime = 0
  ) {}

  execute(document: SequencerDocument): void {
    if (this.track && this.pattern) {
      document.patterns.add(this.pattern);
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
    const track = createTrack(this.trackName);
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

    track.placements.push(placement);
    document.patterns.add(pattern);
    document.tracks.add(track);
    addDefaultTrackParameters(document, track);

    this.track = track;
    this.pattern = pattern;
    this.parameterDefinitions = document.parameterDefinitions
      .values()
      .filter((definition) => !existingDefinitionIds.has(definition.id));
    this.parameters = document.parameters
      .values()
      .filter((parameter) => !existingParameterIds.has(parameter.id));
  }

  undo(document: SequencerDocument): void {
    if (!this.track || !this.pattern) return;

    document.tracks.remove(this.track.id);
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
