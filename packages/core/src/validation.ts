import type { SequencerDocument } from "./document";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  entityId?: string;
}

export function validateDocument(document: SequencerDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (document.timeline.length <= 0) {
    issues.push({
      level: "error",
      message: "Timeline length must be greater than zero",
      entityId: document.id
    });
  }

  for (const marker of document.timeline.markers) {
    if (marker.time < 0) {
      issues.push({
        level: "error",
        message: "Timeline marker time cannot be negative",
        entityId: marker.id
      });
    }

    if (marker.time > document.timeline.length) {
      issues.push({
        level: "warning",
        message: "Timeline marker is beyond the project timeline length",
        entityId: marker.id
      });
    }
  }

  for (const track of document.tracks.values()) {
    track.clips ??= [];

    for (const parameterId of track.parameters) {
      if (!document.parameters.has(parameterId)) {
        issues.push({
          level: "error",
          message: `Track references missing parameter: ${parameterId}`,
          entityId: track.id
        });
      }
    }

    if (track.deviceId && !document.deviceInstances.has(track.deviceId)) {
      issues.push({
        level: "error",
        message: `Track references missing device instance: ${track.deviceId}`,
        entityId: track.id
      });
    }

    const slotIndexes = new Set<number>();

    for (const slot of track.clips) {
      if (!document.midiClips.has(slot.target)) {
        issues.push({
          level: "error",
          message: `Track clip slot references missing clip: ${slot.target}`,
          entityId: slot.id
        });
      }

      if (slot.source !== track.id) {
        issues.push({
          level: "error",
          message: "Track clip slot source does not match parent track",
          entityId: slot.id
        });
      }

      if (slot.slotIndex < 0) {
        issues.push({
          level: "error",
          message: "Track clip slot index cannot be negative",
          entityId: slot.id
        });
      }

      if (slotIndexes.has(slot.slotIndex)) {
        issues.push({
          level: "warning",
          message: "Track has duplicate clip slot indexes",
          entityId: slot.id
        });
      }

      slotIndexes.add(slot.slotIndex);
    }

    for (const placement of track.placements) {
      if (!document.patterns.has(placement.target)) {
        issues.push({
          level: "error",
          message: `Placement references missing pattern: ${placement.target}`,
          entityId: placement.id
        });
      }

      if (placement.source !== track.id) {
        issues.push({
          level: "error",
          message: `Placement source does not match parent track`,
          entityId: placement.id
        });
      }

      if (placement.start < 0) {
        issues.push({
          level: "error",
          message: `Placement start cannot be negative`,
          entityId: placement.id
        });
      }

      const placementLength = placement.length ?? 0;
      const placementEnd = (placement.loop ?? true)
        ? document.timeline.length
        : placement.start + placementLength * (placement.loopCount ?? 1);
      const loopStart = placement.loopStart ?? 0;
      const loopLength = placement.loopLength ?? placementLength;

      if (placementEnd > document.timeline.length) {
        issues.push({
          level: "warning",
          message: "Pattern placement extends beyond the project timeline length",
          entityId: placement.id
        });
      }

      if (loopStart < 0 || loopStart > placementLength) {
        issues.push({
          level: "error",
          message: "Pattern placement loop start must be within the clip",
          entityId: placement.id
        });
      }

      if (loopLength <= 0 || loopStart + loopLength > placementLength) {
        issues.push({
          level: "error",
          message: "Pattern placement loop length must fit within the clip",
          entityId: placement.id
        });
      }
    }
  }

  for (const clip of document.midiClips.values()) {
    if (!document.patterns.has(clip.pattern)) {
      issues.push({
        level: "error",
        message: `MIDI clip references missing pattern: ${clip.pattern}`,
        entityId: clip.id
      });
    }

    if (clip.length <= 0) {
      issues.push({
        level: "error",
        message: "MIDI clip length must be greater than zero",
        entityId: clip.id
      });
    }

    if (clip.loopStart < 0 || clip.loopStart > clip.length) {
      issues.push({
        level: "error",
        message: "MIDI clip loop start must be within the clip",
        entityId: clip.id
      });
    }

    if (clip.loopLength <= 0 || clip.loopStart + clip.loopLength > clip.length) {
      issues.push({
        level: "error",
        message: "MIDI clip loop length must fit within the clip",
        entityId: clip.id
      });
    }
  }

  for (const pattern of document.patterns.values()) {
    for (const event of pattern.events) {
      if (event.target && !document.parameters.has(event.target)) {
        issues.push({
          level: "error",
          message: `Timeline event references missing parameter: ${event.target}`,
          entityId: event.id
        });
      }

      if (event.time < 0) {
        issues.push({
          level: "error",
          message: "Timeline event time cannot be negative",
          entityId: event.id
        });
      }

      if (event.time > pattern.length) {
        issues.push({
          level: "warning",
          message: "Timeline event is beyond the pattern length",
          entityId: event.id
        });
      }
    }
  }

  for (const parameter of document.parameters.values()) {
    const definition = document.parameterDefinitions.find(
      parameter.definitionId
    );

    if (!definition) {
      issues.push({
        level: "error",
        message: `Parameter references missing definition: ${parameter.definitionId}`,
        entityId: parameter.id
      });

      continue;
    }

    if (definition.kind === "number") {
      if (typeof parameter.value !== "number") {
        issues.push({
          level: "error",
          message: "Number parameter must have a numeric value",
          entityId: parameter.id
        });
      }

      if (
        typeof parameter.value === "number" &&
        definition.min !== undefined &&
        parameter.value < definition.min
      ) {
        issues.push({
          level: "warning",
          message: "Parameter value is below minimum",
          entityId: parameter.id
        });
      }

      if (
        typeof parameter.value === "number" &&
        definition.max !== undefined &&
        parameter.value > definition.max
      ) {
        issues.push({
          level: "warning",
          message: "Parameter value is above maximum",
          entityId: parameter.id
        });
      }
    }

    if (definition.kind === "boolean" && typeof parameter.value !== "boolean") {
      issues.push({
        level: "error",
        message: "Boolean parameter must have a boolean value",
        entityId: parameter.id
      });
    }

    if (definition.kind === "choice") {
      const validValues =
        definition.options?.map((option) => option.value) ?? [];

      if (!validValues.includes(parameter.value)) {
        issues.push({
          level: "error",
          message: "Choice parameter value is not in the available options",
          entityId: parameter.id
        });
      }
    }

    if (definition.kind === "text" && typeof parameter.value !== "string") {
      issues.push({
        level: "error",
        message: "Text parameter must have a string value",
        entityId: parameter.id
      });
    }
  }

  return issues;
}

export function validateProject(project: SequencerDocument): ValidationIssue[] {
  return validateDocument(project);
}
