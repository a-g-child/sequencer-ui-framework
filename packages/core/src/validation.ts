import type { SequencerProject } from "./project";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  entityId?: string;
}

export function validateProject(project: SequencerProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (project.timeline.length <= 0) {
    issues.push({
      level: "error",
      message: "Timeline length must be greater than zero",
      entityId: project.id
    });
  }

  for (const marker of project.timeline.markers) {
    if (marker.time < 0) {
      issues.push({
        level: "error",
        message: "Timeline marker time cannot be negative",
        entityId: marker.id
      });
    }

    if (marker.time > project.timeline.length) {
      issues.push({
        level: "warning",
        message: "Timeline marker is beyond the project timeline length",
        entityId: marker.id
      });
    }
  }

  for (const track of project.tracks.values()) {
    for (const placement of track.placements) {
      if (!project.patterns.has(placement.target)) {
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

      const placementEnd =
        placement.start + (placement.length ?? 0) * (placement.loopCount ?? 1);

      if (placementEnd > project.timeline.length) {
        issues.push({
          level: "warning",
          message: "Pattern placement extends beyond the project timeline length",
          entityId: placement.id
        });
      }
    }
  }

  return issues;
}
