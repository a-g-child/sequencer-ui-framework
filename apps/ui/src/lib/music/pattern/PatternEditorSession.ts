import type { EntityId, GrooveSettings } from '@sequencer/core';
import type { AppController } from '../../app-controller.ts';
import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model.ts';
import {
  RendererRegistry,
  type EditorSession,
  type RenderInteractionItem
} from '../../framework/editor/index.ts';
import {
  createGridDefinition,
  type GridDefinition
} from './pattern-grid.ts';
import { buildPatternInteractionContext as createPatternInteractionContext } from './pattern-interaction-builder.ts';
import { PatternInputState } from './pattern-input-state.ts';
import {
  clampViewport,
  panViewportX,
  panViewportY,
  resetViewport,
  zoomViewportX,
  type PatternNavigationBounds
} from './pattern-navigation.ts';
import {
  PianoRollRenderer,
  SAMPLE_GRID_LANE_COUNT,
  SampleGridRenderer,
  type PatternRenderModel,
  type PatternRenderer,
  type SampleGridLane
} from './pattern-renderer.ts';
import {
  defaultScaleState,
  isPitchInScale,
  type PatternScaleMode,
  type PatternScaleState
} from './pattern-scale.ts';
import { PatternRenderModelBuilder } from './PatternRenderModelBuilder.ts';
import { handlePatternShortcut } from './pattern-shortcuts.ts';
import type {
  PatternInteractionContext,
  PatternNoteOverlay,
  PatternOverlay,
  PatternRectangleOverlay,
  PatternTool
} from './pattern-tool.ts';
import {
  createPatternViewport,
  type PatternViewport
} from './pattern-viewport.ts';
import { DrawNoteTool } from './tools/draw-note-tool.ts';
import { EraseNoteTool } from './tools/erase-note-tool.ts';
import { HumanizeNoteTool } from './tools/humanize-note-tool.ts';
import { MoveNoteTool } from './tools/move-note-tool.ts';
import { ResizeNoteTool } from './tools/resize-note-tool.ts';
import { SelectTool } from './tools/select-tool.ts';

export type PatternEditorSessionOptions = {
  controller: AppController;
  renderer?: PatternRenderer<PianoRollView>;
  bars?: number;
  totalBars?: number;
  beatsPerBar?: number;
  beatDivisions?: number;
  visibleLength?: number;
  groove?: GrooveSettings;
};

export type PatternEditorTimelineOptions = {
  bars?: number;
  totalBars?: number;
  beatsPerBar?: number;
  beatDivisions?: number;
  visibleLength?: number;
};

export type PatternPointerResult = {
  syncView?: boolean;
};

export type PatternRendererId = 'piano-roll' | 'sample-grid';

export type PatternRendererDefinition = {
  id: PatternRendererId;
  name: string;
  description: string;
};

const defaultBeatsPerBar = 4;
const defaultTotalBars = 4;
const defaultBeatDivisions = 4;
const middleCPitch = 60;
const minViewportZoom = 0.5;
const maxViewportZoom = 4;

export class PatternEditorSession implements EditorSession {
  readonly controller: AppController;
  grid: GridDefinition = createGridDefinition({ majorEvery: defaultBeatsPerBar });
  readonly input = new PatternInputState();
  readonly tools: PatternTool[];
  readonly rendererRegistry = new RendererRegistry<PatternRenderer<PianoRollView>>();
  readonly renderers: PatternRendererDefinition[] = [
    {
      id: 'piano-roll',
      name: 'Piano Roll',
      description: 'Free melodic and polyphonic note editing'
    },
    {
      id: 'sample-grid',
      name: 'Sample Grid',
      description: 'Fixed-lane sample sequencing'
    }
  ];
  readonly renderModelBuilder = new PatternRenderModelBuilder();
  readonly middleCPitch = middleCPitch;

  activeTool: PatternTool;
  activeRendererId: PatternRendererId = 'piano-roll';
  activeClipId: EntityId | undefined;
  viewport: PatternViewport = resetViewport();
  interactionContext: PatternInteractionContext | undefined;
  isPanning = false;
  hoveredNoteId: string | undefined;
  ghostBeat = 0;
  ghostPitch = middleCPitch;
  showGhost = false;
  scale: PatternScaleState = { ...defaultScaleState };

  private lastPanX = 0;
  private lastPanY = 0;
  private totalBars = defaultTotalBars;
  private beatsPerBar = defaultBeatsPerBar;
  private beatDivisions = defaultBeatDivisions;
  private explicitVisibleLength: number | undefined;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private sampleGridLaneCount = SAMPLE_GRID_LANE_COUNT;
  private groove: GrooveSettings | undefined;

  constructor(options: PatternEditorSessionOptions) {
    const resizeNoteTool = new ResizeNoteTool();

    const renderer = options.renderer ?? new PianoRollRenderer();

    this.controller = options.controller;
    this.configureTimeline({
      bars: options.bars,
      totalBars: options.totalBars,
      beatsPerBar: options.beatsPerBar,
      beatDivisions: options.beatDivisions,
      visibleLength: options.visibleLength
    });
    this.setGroove(options.groove);
    this.rendererRegistry.register(new PianoRollRenderer());
    this.rendererRegistry.register(new SampleGridRenderer());
    this.rendererRegistry.register(renderer);
    this.activeRendererId = isPatternRendererId(renderer.id)
      ? renderer.id
      : 'piano-roll';
    this.tools = [
      new SelectTool(),
      new DrawNoteTool(),
      new EraseNoteTool(),
      new MoveNoteTool(),
      resizeNoteTool,
      new HumanizeNoteTool()
    ];
    this.activeTool = this.tools[0];
  }

  get renderer(): PatternRenderer<PianoRollView> {
    const renderer = this.rendererRegistry.get(this.activeRendererId);

    if (!renderer) {
      throw new Error(`Missing pattern renderer: ${this.activeRendererId}`);
    }

    return renderer;
  }

  configureTimeline(options: PatternEditorTimelineOptions): boolean {
    const nextTotalBars = normaliseTimelineUnit(
      options.totalBars ?? options.bars,
      defaultTotalBars
    );
    const nextBeatsPerBar = normaliseTimelineUnit(
      options.beatsPerBar,
      defaultBeatsPerBar
    );
    const nextBeatDivisions = normaliseTimelineUnit(
      options.beatDivisions,
      defaultBeatDivisions
    );
    const nextVisibleLength =
      typeof options.visibleLength === 'number' && options.visibleLength > 0
        ? options.visibleLength
        : undefined;
    const changed =
      nextTotalBars !== this.totalBars ||
      nextBeatsPerBar !== this.beatsPerBar ||
      nextBeatDivisions !== this.beatDivisions ||
      nextVisibleLength !== this.explicitVisibleLength;

    this.totalBars = nextTotalBars;
    this.beatsPerBar = nextBeatsPerBar;
    this.beatDivisions = nextBeatDivisions;
    this.explicitVisibleLength = nextVisibleLength;
    this.grid = createGridDefinition({
      ...this.grid,
      majorEvery: nextBeatsPerBar,
      subdivision: nextBeatDivisions,
      snap: 1 / nextBeatDivisions
    });

    if (changed) {
      this.refreshOverlay();
    }

    return changed;
  }

  setViewportWidth(width: number, pianoRoll: PianoRollView | undefined): boolean {
    const nextWidth = Math.max(0, width);

    if (nextWidth === this.viewportWidth) return false;

    this.viewportWidth = nextWidth;
    this.applyViewport(this.viewport, pianoRoll);

    return true;
  }

  setViewportHeight(
    height: number,
    pianoRoll: PianoRollView | undefined
  ): boolean {
    const nextHeight = Math.max(0, height);

    if (nextHeight === this.viewportHeight) return false;

    this.viewportHeight = nextHeight;
    this.applyViewport(this.viewport, pianoRoll);

    return true;
  }

  setActiveTool(tool: PatternTool): void {
    this.activeTool.cancel?.();
    this.activeTool = tool;
    this.refreshOverlay();
  }

  setActiveRenderer(id: PatternRendererId): void {
    if (id === this.activeRendererId) return;

    this.activeTool.cancel?.();
    this.activeRendererId = id;
    this.clearHover();
    this.refreshOverlay();
  }

  setActiveClip(clipId: EntityId | undefined): void {
    this.activeClipId = clipId;
  }

  setGroove(groove: GrooveSettings | undefined): void {
    this.groove = groove;
    this.viewport = {
      ...this.viewport,
      groove
    };
    this.refreshOverlay();
  }

  setScaleRoot(root: number): void {
    this.scale = {
      ...this.scale,
      root: Math.min(11, Math.max(0, Math.round(root)))
    };
    this.refreshOverlay();
  }

  setScaleId(scaleId: string): void {
    this.scale = { ...this.scale, scaleId };
    this.refreshOverlay();
  }

  setScaleMode(mode: PatternScaleMode): void {
    this.scale = { ...this.scale, mode };
    this.refreshOverlay();
  }

  applyViewport(next: PatternViewport, pianoRoll: PianoRollView | undefined): void {
    this.viewport = clampViewport(next, this.navigationBounds(pianoRoll));
    this.refreshOverlay();
  }

  setViewport(
    next: {
      zoomX?: number;
      zoomY?: number;
      scrollX?: number;
      scrollY?: number;
    },
    pianoRoll: PianoRollView | undefined
  ): void {
    this.applyViewport(
      createPatternViewport({
        zoomX: next.zoomX ?? this.viewport.zoomX,
        zoomY: next.zoomY ?? this.viewport.zoomY,
        scrollX: next.scrollX ?? this.viewport.scrollX,
        scrollY: next.scrollY ?? this.viewport.scrollY,
        groove: this.groove
      }),
      pianoRoll
    );
  }

  resetViewport(pianoRoll: PianoRollView | undefined): void {
    this.applyViewport({ ...resetViewport(), groove: this.groove }, pianoRoll);
  }

  zoomViewportX(
    multiplier: number,
    pianoRoll: PianoRollView | undefined
  ): void {
    this.applyViewport(
      zoomViewportX(
        this.viewport,
        multiplier,
        this.navigationBounds(pianoRoll)
      ),
      pianoRoll
    );
  }

  zoomViewportY(
    multiplier: number,
    pianoRoll: PianoRollView | undefined
  ): void {
    this.setViewport(
      {
        zoomY: clampNumber(
          this.viewport.zoomY * multiplier,
          minViewportZoom,
          maxViewportZoom
        )
      },
      pianoRoll
    );
  }

  scrollViewport(
    deltaBeats: number,
    pianoRoll: PianoRollView | undefined
  ): void {
    this.applyViewport(
      panViewportX(
        this.viewport,
        deltaBeats,
        this.navigationBounds(pianoRoll)
      ),
      pianoRoll
    );
  }

  scrollPitch(
    deltaSemitones: number,
    pianoRoll: PianoRollView | undefined
  ): void {
    this.applyViewport(
      panViewportY(
        this.viewport,
        deltaSemitones,
        this.navigationBounds(pianoRoll)
      ),
      pianoRoll
    );
  }

  navigationBounds(pianoRoll: PianoRollView | undefined): PatternNavigationBounds {
    const pitchCount = this.activePitchCount(pianoRoll);
    const visiblePitchCount = this.viewportHeight / this.viewport.pixelsPerSemitone;
    const contentLength = this.visibleLength(pianoRoll);
    const visibleBeats = this.viewportWidth / this.viewport.pixelsPerBeat;
    const maxScrollX = Math.max(0, contentLength - visibleBeats);
    const minPixelsPerSemitone =
      this.activeRendererId === 'sample-grid' && this.viewportHeight > 0
        ? this.viewportHeight / Math.max(1, pitchCount)
        : undefined;

    return {
      maxScrollX,
      contentLength,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      pitchCount,
      minPixelsPerSemitone,
      minScrollY: 0,
      maxScrollY: Math.max(0, pitchCount - visiblePitchCount)
    };
  }

  private activePitchCount(pianoRoll: PianoRollView | undefined): number {
    if (this.activeRendererId === 'sample-grid') return this.sampleGridLaneCount;
    if (this.scale.mode === 'fold' && pianoRoll) {
      return Math.max(
        1,
        pianoRoll.pitchRows.filter((pitch) => isPitchInScale(pitch, this.scale)).length
      );
    }

    return pianoRoll ? pianoRoll.pitchCount : 0;
  }

  visibleLength(pianoRoll: PianoRollView | undefined): number {
    return this.explicitVisibleLength ?? this.totalBars * this.beatsPerBar;
  }

  noteHeight(): number {
    return Math.max(6, this.viewport.pixelsPerSemitone - 2);
  }

  selectedNotes(pianoRoll: PianoRollView | undefined): PianoRollNoteView[] {
    if (!pianoRoll) return [];

    const selected = this.controller.store.selection.current();

    if (selected?.type !== 'note') return [];
    const selectedNoteIds = selected.ids ?? [selected.id];

    return pianoRoll.notes.filter((note) => selectedNoteIds.includes(note.id));
  }

  buildRenderModel(pianoRoll: PianoRollView): PatternRenderModel {
    return this.renderModelBuilder.build({
      document: pianoRoll,
      session: this,
      renderer: this.renderer
    });
  }

  setSampleGridLanes(lanes: readonly SampleGridLane[] | undefined): void {
    const renderer = this.rendererRegistry.get('sample-grid');

    if (renderer instanceof SampleGridRenderer) {
      renderer.setLanes(lanes);
    }

    this.sampleGridLaneCount = Math.max(
      1,
      lanes?.length ?? SAMPLE_GRID_LANE_COUNT
    );
  }

  handleWheel(event: WheelEvent, pianoRoll: PianoRollView | undefined): void {
    event.preventDefault();
    this.input.setKeyboardModifiers(event);

    if (this.input.modifiers.primary) {
      this.applyViewport(
        zoomViewportX(
          this.viewport,
          event.deltaY < 0 ? 1.1 : 0.9,
          this.navigationBounds(pianoRoll)
        ),
        pianoRoll
      );
      return;
    }

    if (this.input.modifiers.shift) {
      this.applyViewport(
        panViewportY(
          this.viewport,
          event.deltaY > 0 ? 2 : -2,
          this.navigationBounds(pianoRoll)
        ),
        pianoRoll
      );
      return;
    }

    this.applyViewport(
      panViewportX(
        this.viewport,
        event.deltaY / this.viewport.pixelsPerBeat,
        this.navigationBounds(pianoRoll)
      ),
      pianoRoll
    );
  }

  handleKeyDown(
    event: KeyboardEvent,
    options: {
      pianoRoll: PianoRollView | undefined;
      syncView: () => void;
    }
  ): boolean {
    if (isEditableEventTarget(event.target)) return false;

    this.input.setKeyboardModifiers(event);

    const handled = handlePatternShortcut(event, {
      controller: this.controller,
      viewport: this.viewport,
      navigationBounds: this.navigationBounds(options.pianoRoll),
      patternId: options.pianoRoll?.patternId,
      selectedNotes: this.selectedNotes(options.pianoRoll),
      pasteTargetBeat: this.pasteTargetBeat(),
      applyViewport: (viewport) => this.applyViewport(viewport, options.pianoRoll),
      resetViewport: () => this.resetViewport(options.pianoRoll),
      syncView: options.syncView
    });

    if (handled) {
      event.preventDefault();
    }

    return handled;
  }

  beginPan(event: PointerEvent): boolean {
    if (event.button !== 1) return false;

    event.preventDefault();
    this.clearHover();
    this.isPanning = true;
    this.lastPanX = event.clientX;
    this.lastPanY = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    return true;
  }

  movePan(event: PointerEvent, pianoRoll: PianoRollView | undefined): boolean {
    if (!this.isPanning) return false;

    const dx = event.clientX - this.lastPanX;
    const dy = event.clientY - this.lastPanY;

    let nextViewport = panViewportX(
      this.viewport,
      -dx / this.viewport.pixelsPerBeat,
      this.navigationBounds(pianoRoll)
    );
    nextViewport = panViewportY(
      nextViewport,
      dy / this.viewport.pixelsPerSemitone,
      this.navigationBounds(pianoRoll)
    );
    this.applyViewport(nextViewport, pianoRoll);

    this.lastPanX = event.clientX;
    this.lastPanY = event.clientY;

    return true;
  }

  endPan(): boolean {
    if (!this.isPanning) return false;

    this.isPanning = false;
    return true;
  }

  handlePointerEnter(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    const context = this.buildInteractionContext(event, pianoRoll);

    if (!context) return {};

    this.interactionContext = context;
    this.updateHover(context);
    this.activeTool.pointerEnter?.(context);
    this.refreshOverlay();

    return {};
  }

  handlePointerDown(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.beginPan(event)) return {};

    const context = this.buildInteractionContext(event, pianoRoll);

    if (!context) return {};

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.interactionContext = context;
    this.updateHover(context);
    this.activeTool.pointerDown(context);
    this.refreshOverlay();

    return { syncView: true };
  }

  handlePointerMove(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.movePan(event, pianoRoll)) return {};

    const context = this.buildInteractionContext(event, pianoRoll);

    if (!context) return {};

    this.interactionContext = context;
    this.updateHover(context);
    this.activeTool.pointerMove?.(context);
    this.refreshOverlay();

    return {};
  }

  handlePointerUp(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.endPan()) return {};

    const context = this.buildInteractionContext(event, pianoRoll);

    if (!context) return {};

    this.interactionContext = context;
    this.updateHover(context);
    this.activeTool.pointerUp?.(context);
    this.refreshOverlay();

    return { syncView: true };
  }

  handlePointerLeave(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.isPanning) return {};

    const context = this.buildInteractionContext(event, pianoRoll);

    if (!context) return {};

    this.interactionContext = context;
    this.clearHover();
    this.activeTool.pointerLeave?.(context);

    if (!['move-note', 'resize-note'].includes(this.activeTool.id)) {
      this.interactionContext = undefined;
    }

    this.refreshOverlay();

    return {};
  }

  handleNotePointerDown(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined,
    item: RenderInteractionItem<PianoRollNoteView>
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.beginPan(event)) return {};

    const context = this.buildInteractionContext(event, pianoRoll, item);

    if (!context) return {};

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.interactionContext = context;
    this.updateHover(context);
    this.activeTool.pointerDown(context);
    this.refreshOverlay();

    return {
      syncView: !['move-note', 'resize-note'].includes(this.activeTool.id)
    };
  }

  handleNotePointerMove(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined,
    item: RenderInteractionItem<PianoRollNoteView>
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.movePan(event, pianoRoll)) return {};

    const context = this.buildInteractionContext(event, pianoRoll, item);

    if (!context) return {};

    this.interactionContext = context;
    this.updateHover(context);
    this.activeTool.pointerMove?.(context);
    this.refreshOverlay();

    return {};
  }

  handleNotePointerUp(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined,
    item: RenderInteractionItem<PianoRollNoteView>
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.endPan()) return {};

    const context = this.buildInteractionContext(event, pianoRoll, item);

    if (!context) return {};

    this.interactionContext = context;
    this.updateHover(context);
    this.activeTool.pointerUp?.(context);
    this.refreshOverlay();

    return { syncView: true };
  }

  createC4Note(pianoRoll: PianoRollView | undefined): boolean {
    if (!pianoRoll) return false;

    this.controller.createNote(pianoRoll.patternId, 0, 1, 60);
    return true;
  }

  private buildInteractionContext(
    event: PointerEvent,
    pianoRoll: PianoRollView | undefined,
    hoveredItem?: RenderInteractionItem<PianoRollNoteView>
  ): PatternInteractionContext | undefined {
    if (!pianoRoll) return undefined;

    const renderModel = this.buildRenderModel(pianoRoll);

    return createPatternInteractionContext({
      event,
      element: event.currentTarget as HTMLElement,
      controller: this.controller,
      patternId: pianoRoll.patternId,
      input: this.input,
      viewport: this.viewport,
      grid: this.grid,
      pianoRoll,
      renderer: this.renderer,
      renderModel,
      hoveredItem
    });
  }

  private updateHover(context: PatternInteractionContext): void {
    this.hoveredNoteId = context.hoveredItem?.source.id;
    this.ghostBeat = context.musical.beat;
    this.ghostPitch = context.musical.pitch;
    this.showGhost = !context.hoveredItem;
  }

  private clearHover(): void {
    this.hoveredNoteId = undefined;
    this.showGhost = false;
  }

  private refreshOverlay(): void {
    this.interactionContext = this.interactionContext
      ? { ...this.interactionContext }
      : undefined;
  }

  private overlays(): PatternOverlay[] {
    if (!this.interactionContext) return [];
    if (this.activeTool.id === 'draw-note') return [];

    return this.activeTool.drawOverlay?.(this.interactionContext) ?? [];
  }

  overlayNotes(): PatternNoteOverlay[] {
    return this.overlays().filter(
      (overlay): overlay is PatternNoteOverlay => overlay.type === 'note'
    );
  }

  overlayRectangles(): PatternRectangleOverlay[] {
    return this.overlays().filter(
      (overlay): overlay is PatternRectangleOverlay =>
        overlay.type === 'rectangle'
    );
  }

  private pasteTargetBeat(): number {
    return this.showGhost ? this.ghostBeat : this.controller.transportBeat;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normaliseTimelineUnit(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;

  return Math.max(1, Math.floor(value));
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]')
  );
}

function isPatternRendererId(id: string): id is PatternRendererId {
  return id === 'piano-roll' || id === 'sample-grid';
}
