import type { Entity } from "./entity";
import type { Relationship } from "./relationship";
import type { BeatTime, TimelineEvent } from "./events";
import type { ParameterOwner } from "./parameter-owner";
import type { SequencerDocument } from "./document";
import type { EntityRef } from "./reference";
import type { DeviceInstance } from "@sequencer/device";

export interface Pattern extends Entity {
  length: BeatTime;
  events: TimelineEvent[];
}

export interface MidiClip extends Entity {
  pattern: EntityRef<Pattern>;
  length: BeatTime;
  loopEnabled: boolean;
  loopStart: BeatTime;
  loopLength: BeatTime;
}

export interface Track extends Entity, ParameterOwner {
  clips: TrackClipSlot[];
  placements: PatternPlacement[];
  deviceId?: EntityRef<DeviceInstance>;
  target?: string;
}

export interface TrackClipSlot extends Relationship<Track, MidiClip> {
  slotIndex: number;
}

export interface PatternPlacement extends Relationship<Track, Pattern> {
  start: BeatTime;
  length?: BeatTime;
  loop?: boolean;
  loopStart?: BeatTime;
  loopLength?: BeatTime;
  loopCount?: number;
}

export type SequencerProject = SequencerDocument;
