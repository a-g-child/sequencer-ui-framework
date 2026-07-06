<script lang="ts">
  import type { PatternRenderModel } from './pattern-renderer';
  import {
    automationSegmentsToSvgPath,
    createAutomationSegments,
    denormaliseAutomationValue,
    normaliseAutomationValue,
    sampleAutomationSegments,
    type AutomationCurvePoint,
    type PatternAutomationTarget
  } from './pattern-automation';
  import { patternLengthToScreenWidth } from './pattern-viewport';

  export let renderModel: PatternRenderModel;
  export let targets: PatternAutomationTarget[] = [];
  export let selectedTargetId = '';
  export let points: AutomationCurvePoint[] = [];
  export let onTargetChange: (parameterId: string) => void;
  export let onPointsChange: (points: AutomationCurvePoint[]) => void;
  export let onPointsCommit: (points: AutomationCurvePoint[]) => void;

  const laneHeight = 64;
  const hitRadius = 14;
  const longPressMs = 550;

  let laneElement: HTMLDivElement | undefined;
  let activePointIndex: number | undefined;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerMoved = false;

  $: laneWidth = patternLengthToScreenWidth(
    renderModel.visibleLength,
    renderModel.viewport
  );
  $: target =
    targets.find((item) => item.parameter.id === selectedTargetId) ?? targets[0];
  $: segments = target
    ? createAutomationSegments(points, target.value, 0, renderModel.visibleLength)
    : [];
  $: sampleValue = segments.length > 0
    ? sampleAutomationSegments(segments, 0)
    : 0;
  $: valueNormalised = target
    ? normaliseAutomationValue(sampleValue, target.min, target.max)
    : 0;
  $: valueY = laneHeight - valueNormalised * laneHeight;
  $: curvePath = target
    ? automationSegmentsToSvgPath(segments, laneWidth, laneHeight, target.min, target.max)
    : '';
  $: nodeViews = target
    ? points.map((point, index) => ({
      index,
      x: beatToLaneX(point.beat),
      y: valueToLaneY(point.value, target.min, target.max)
    }))
    : [];

  function beginAutomationPointer(event: PointerEvent): void {
    if (!target || !laneElement) return;

    event.preventDefault();
    event.stopPropagation();
    laneElement.setPointerCapture(event.pointerId);

    const point = pointFromPointer(event, target);
    const nearestIndex = findNearestPointIndex(point);

    pointerMoved = false;

    if (nearestIndex === undefined) {
      const nextPoints = [...points, point].sort((left, right) => left.beat - right.beat);

      onPointsChange(nextPoints);
      onPointsCommit(nextPoints);
      activePointIndex = nextPoints.findIndex((item) => item === point);
      return;
    }

    activePointIndex = nearestIndex;
    startLongPressTimer();
  }

  function moveAutomationPointer(event: PointerEvent): void {
    if (!target || activePointIndex === undefined) return;

    pointerMoved = true;
    clearLongPressTimer();
    moveActivePoint(event, target);
  }

  function endAutomationPointer(event: PointerEvent): void {
    let nextPoints = points;

    if (activePointIndex !== undefined && target && pointerMoved) {
      nextPoints = moveActivePoint(event, target);
    }

    if (pointerMoved) {
      onPointsCommit(nextPoints);
    }

    activePointIndex = undefined;
    pointerMoved = false;
    clearLongPressTimer();
  }

  function moveActivePoint(
    event: PointerEvent,
    automationTarget: PatternAutomationTarget
  ): AutomationCurvePoint[] {
    if (activePointIndex === undefined) return points;

    const nextPoint = pointFromPointer(event, automationTarget);
    const pointId = points[activePointIndex];
    const nextPoints = points
      .map((point) => (point === pointId ? nextPoint : point))
      .sort((left, right) => left.beat - right.beat);

    onPointsChange(nextPoints);
    activePointIndex = nextPoints.findIndex((point) => point === nextPoint);
    return nextPoints;
  }

  function startLongPressTimer(): void {
    clearLongPressTimer();

    longPressTimer = setTimeout(() => {
      if (activePointIndex === undefined || pointerMoved) return;

      const nextPoints = points.filter((_, index) => index !== activePointIndex);

      onPointsChange(nextPoints);
      onPointsCommit(nextPoints);
      activePointIndex = undefined;
    }, longPressMs);
  }

  function clearLongPressTimer(): void {
    if (!longPressTimer) return;

    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }

  function pointFromPointer(
    event: PointerEvent,
    automationTarget: PatternAutomationTarget
  ): AutomationCurvePoint {
    const bounds = laneElement?.getBoundingClientRect();
    const x = bounds ? event.clientX - bounds.left : 0;
    const y = bounds ? event.clientY - bounds.top : 0;
    const beat = laneXToBeat(x);
    const normalisedValue = 1 - Math.min(1, Math.max(0, y / laneHeight));

    return {
      beat,
      value: denormaliseAutomationValue(
        normalisedValue,
        automationTarget.min,
        automationTarget.max
      )
    };
  }

  function findNearestPointIndex(point: AutomationCurvePoint): number | undefined {
    const nearest = nodeViews
      .map((node) => ({
        index: node.index,
        distance: Math.hypot(node.x - beatToLaneX(point.beat), node.y - valueToLaneY(point.value, target?.min ?? 0, target?.max ?? 1))
      }))
      .filter((node) => node.distance <= hitRadius)
      .sort((left, right) => left.distance - right.distance)[0];

    return nearest?.index;
  }

  function beatToLaneX(beat: number): number {
    return (Math.min(renderModel.visibleLength, Math.max(0, beat)) /
      Math.max(1, renderModel.visibleLength)) * laneWidth;
  }

  function laneXToBeat(x: number): number {
    return (Math.min(laneWidth, Math.max(0, x)) / Math.max(1, laneWidth)) *
      renderModel.visibleLength;
  }

  function valueToLaneY(value: number, min: number, max: number): number {
    return laneHeight - normaliseAutomationValue(value, min, max) * laneHeight;
  }
</script>

<div class="velocity-lane automation-lane" aria-label="Clip automation">
  <label>
    <span>Automation</span>
    <select
      value={target?.parameter.id ?? ''}
      disabled={targets.length === 0}
      aria-label="Automation parameter"
      on:change={(event) =>
        onTargetChange((event.currentTarget as HTMLSelectElement).value)}
    >
      {#if targets.length === 0}
        <option value="">No parameters</option>
      {:else}
        {#each targets as item (item.parameter.id)}
          <option value={item.parameter.id}>{item.label}</option>
        {/each}
      {/if}
    </select>
  </label>

  <div
    class="velocity-lane-track automation-lane-track"
    bind:this={laneElement}
    role="application"
    aria-label="Automation curve editor"
    style={`width: ${laneWidth}px; height: ${laneHeight}px;`}
    on:pointerdown={beginAutomationPointer}
    on:pointermove={moveAutomationPointer}
    on:pointerup={endAutomationPointer}
    on:pointercancel={endAutomationPointer}
  >
    {#if target}
      <svg
        viewBox={`0 0 ${Math.max(1, laneWidth)} ${laneHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path class="automation-curve-fill" d={`${curvePath} L ${laneWidth} ${laneHeight} L 0 ${laneHeight} Z`} />
        <path class="automation-curve" d={curvePath} />
      </svg>

      <span
        class="automation-value-line"
        style={`top: ${valueY}px;`}
      ></span>

      {#each nodeViews as node (node.index)}
        <button
          type="button"
          class="automation-node"
          class:active={activePointIndex === node.index}
          aria-label="Automation point"
          title="Drag automation point. Long-press to remove."
          style={`left: ${node.x}px; top: ${node.y}px;`}
          on:pointerdown={beginAutomationPointer}
        ></button>
      {/each}
    {/if}
  </div>
</div>
