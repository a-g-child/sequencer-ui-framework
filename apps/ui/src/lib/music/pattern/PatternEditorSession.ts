import type { AppController } from '../../app-controller';
import type { PianoRollNoteView, PianoRollView } from '../../editors/piano-roll/piano-roll-model';
import type { EditorSession } from '../../framework/editor';
import {
  buildPatternGridLines,
  createGridDefinition
} from './pattern-grid';
import { buildPatternInteractionContext as createPatternInteractionContext } from './pattern-interaction-builder';
import { PatternInputState } from './pattern-input-state';
import {
  clampViewport,
  panViewportX,
  panViewportY,
  resetViewport,
  zoomViewportX,
  type PatternNavigationBounds
} from './pattern-navigation';
import {
  PianoRollRenderer,
  type PatternRenderModel,
  type PatternRenderer
} from './pattern-renderer';
import { handlePatternShortcut } from './pattern-shortcuts';
import { buildPatternSelection } from './pattern-selection';
import type {
  PatternInteractionContext,
  PatternNoteOverlay,
  PatternOverlay,
  PatternRectangleOverlay,
  PatternTool
} from './pattern-tool';
import {
  createPatternViewport,
  type PatternViewport
} from './pattern-viewport';
import { DrawNoteTool } from './tools/draw-note-tool';
import { EraseNoteTool } from './tools/erase-note-tool';
import { MoveNoteTool } from './tools/move-note-tool';
import { ResizeNoteTool } from './tools/resize-note-tool';
import { SelectTool } from './tools/select-tool';

export type PatternEditorSessionOptions = {
  controller: AppController;
  renderer?: PatternRenderer<PianoRollView>;
};

export type PatternPointerResult = {
  syncView?: boolean;
};

const beatsPerBar = 4;
const minimumVisibleBars = 4;
const minimumVisibleBeats = beatsPerBar * minimumVisibleBars;
const middleCPitch = 60;
const minViewportZoom = 0.5;
const maxViewportZoom = 4;

export class PatternEditorSession implements EditorSession {
  readonly controller: AppController;
  readonly grid = createGridDefinition({ majorEvery: beatsPerBar });
  readonly input = new PatternInputState();
  readonly tools: PatternTool[];
  readonly renderer: PatternRenderer<PianoRollView>;
  readonly middleCPitch = middleCPitch;

  activeTool: PatternTool;
  viewport: PatternViewport = resetViewport();
  interactionContext: PatternInteractionContext | undefined;
  isPanning = false;
  hoveredNoteId: string | undefined;
  ghostBeat = 0;
  ghostPitch = middleCPitch;
  showGhost = false;

  private lastPanX = 0;
  private lastPanY = 0;

  constructor(options: PatternEditorSessionOptions) {
    const resizeNoteTool = new ResizeNoteTool();

    this.controller = options.controller;
    this.renderer = options.renderer ?? new PianoRollRenderer();
    this.tools = [
      new SelectTool(),
      new DrawNoteTool(),
      new EraseNoteTool(),
      new MoveNoteTool(),
      resizeNoteTool
    ];
    this.activeTool = this.tools[0];
  }

  setActiveTool(tool: PatternTool): void {
    this.activeTool.cancel?.();
    this.activeTool = tool;
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
        scrollY: next.scrollY ?? this.viewport.scrollY
      }),
      pianoRoll
    );
  }

  resetViewport(pianoRoll: PianoRollView | undefined): void {
    this.applyViewport(resetViewport(), pianoRoll);
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
    const scrollLimit = pianoRoll ? pianoRoll.pitchCount : 0;

    return {
      maxScrollX: this.visibleLength(pianoRoll),
      minScrollY: -scrollLimit,
      maxScrollY: scrollLimit
    };
  }

  visibleLength(pianoRoll: PianoRollView | undefined): number {
    return Math.max(pianoRoll?.length ?? 0, minimumVisibleBeats);
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
    return this.renderer.render({
      viewModel: pianoRoll,
      viewport: this.viewport,
      grid: this.grid,
      visibleLength: this.visibleLength(pianoRoll),
      gridLines: buildPatternGridLines(this.visibleLength(pianoRoll), this.grid),
      selectedNotes: this.selectedNotes(pianoRoll),
      hoveredNoteId: this.hoveredNoteId,
      activeToolId: this.activeTool.id,
      isPanning: this.isPanning,
      noteHeight: this.noteHeight(),
      ghost: this.showGhost
        ? { beat: this.ghostBeat, pitch: this.ghostPitch }
        : undefined,
      overlayNotes: this.overlayNotes(),
      overlayRectangles: this.overlayRectangles()
    });
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
    note: PianoRollNoteView
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.beginPan(event)) return {};

    const context = this.buildInteractionContext(event, pianoRoll, note);

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
    note: PianoRollNoteView
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.movePan(event, pianoRoll)) return {};

    const context = this.buildInteractionContext(event, pianoRoll, note);

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
    note: PianoRollNoteView
  ): PatternPointerResult {
    this.input.setKeyboardModifiers(event);
    if (this.endPan()) return {};

    const context = this.buildInteractionContext(event, pianoRoll, note);

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
    hoveredNote?: PianoRollNoteView
  ): PatternInteractionContext | undefined {
    if (!pianoRoll) return undefined;

    const selection = buildPatternSelection(this.selectedNotes(pianoRoll));

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
      selectedNotes: [
        ...(selection.primary ? [selection.primary] : []),
        ...selection.secondary
      ],
      hoveredNote
    });
  }

  private updateHover(context: PatternInteractionContext): void {
    this.hoveredNoteId = context.hoveredNote?.id;
    this.ghostBeat = context.musical.beat;
    this.ghostPitch = context.musical.pitch;
    this.showGhost = !context.hoveredNote;
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

  private overlayNotes(): PatternNoteOverlay[] {
    return this.overlays().filter(
      (overlay): overlay is PatternNoteOverlay => overlay.type === 'note'
    );
  }

  private overlayRectangles(): PatternRectangleOverlay[] {
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

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]')
  );
}
