import type {
  Pattern,
  PatternPlacement,
  Track
} from "./project";
import type { SequencerDocument } from "./document";
import type { BeatTime } from "./events";
import type { Timeline } from "./timeline";
import { createId } from "./entity";
import { Registry } from "./registry";
import type { Parameter, ParameterDefinition } from "./parameter";
import { addDefaultTrackParameters } from "./default-parameters";

export function createPattern(name = "Pattern A", length = 16): Pattern {
  return {
    id: createId("pattern"),
    name,
    length,
    events: []
  };
}

export function createTrack(name = "Track 1", target?: string): Track {
  return {
    id: createId("track"),
    name,
    placements: [],
    parameters: [],
    target
  };
}

export function createPatternPlacement(
  source: Track["id"],
  target: Pattern["id"],
  start: BeatTime,
  length?: BeatTime,
  loop = true,
  loopStart?: BeatTime,
  loopLength?: BeatTime,
  loopCount?: number
): PatternPlacement {
  return {
    id: createId("placement"),
    name: "Pattern Placement",
    source,
    target,
    start,
    length,
    loop,
    loopStart,
    loopLength,
    loopCount
  };
}

export function createTimeline(length = 16): Timeline {
  return {
    length,
    markers: []
  };
}

export function createDocument(name = "Sequencer"): SequencerDocument {
  const pattern = createPattern();
  const track = createTrack("Track 1");
  const patterns = new Registry<Pattern>();
  const tracks = new Registry<Track>();
  const timeline = createTimeline();

  track.placements.push(
    createPatternPlacement(track.id, pattern.id, 0, pattern.length)
  );
  patterns.add(pattern);
  tracks.add(track);

  const document: SequencerDocument = {
    id: createId("document"),
    name,
    bpm: 120,
    timeline,
    tracks,
    patterns,
    parameterDefinitions: new Registry<ParameterDefinition>(),
    parameters: new Registry<Parameter>()
  };

  addDefaultTrackParameters(document, track);

  return document;
}

export function createProject(name = "Sequencer"): SequencerDocument {
  return createDocument(name);
}
