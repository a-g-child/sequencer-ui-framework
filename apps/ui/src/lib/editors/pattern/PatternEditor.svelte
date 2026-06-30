<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AppController } from '../../app-controller';
  import { EDITORS } from '../editor-registry';
  import type { EditorKind } from '../editor-types';
  import type { PianoRollNoteView, PianoRollView } from '../piano-roll/piano-roll-model';
  import { PatternEditorSession } from './PatternEditorSession';
  import type { PatternPointerResult } from './PatternEditorSession';
  import {
    beatToScreenX,
    durationToScreenWidth,
    patternLengthToScreenWidth,
    pitchRangeToScreenHeight,
    pitchToScreenY
  } from './pattern-viewport';
  import PatternToolbar from './PatternToolbar.svelte';

  export let controller: AppController;
  export let pianoRoll: PianoRollView | undefined;
  export let activeEditor: EditorKind;
  export let onEditorChange: (editor: EditorKind) => void;
  export let syncView: () => void;

  const middleCPitch = 60;
  const viewportZoomStep = 1.25;
  const viewportBeatScrollStep = 1;
  const viewportPitchScrollStep = 6;

  let session: PatternEditorSession;
  let pianoRollScrollElement: HTMLDivElement | undefined;

  $: if (controller && (!session || session.controller !== controller)) {
    session = new PatternEditorSession({ controller });
  }

  $: renderModel = session && pianoRoll
    ? session.buildRenderModel(pianoRoll)
    : undefined;

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  function noteName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;

    return `${names[pitch % 12]}${octave}`;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (activeEditor !== 'piano-roll') return;

    session.handleKeyDown(event, { pianoRoll, syncView });
    invalidateSession();
  }

  function invalidateSession() {
    session = session;
  }

  function applyPointerResult(result: PatternPointerResult) {
    if (result.syncView) {
      syncView();
    }

    invalidateSession();
  }

  function addC4Note() {
    if (session.createC4Note(pianoRoll)) {
      syncView();
      invalidateSession();
    }
  }

  function resetPatternViewport() {
    session.resetViewport(pianoRoll);
    invalidateSession();
    void tick().then(() => centerPianoRollScroll());
  }

  function handlePatternWheel(event: WheelEvent) {
    session.handleWheel(event, pianoRoll);
    invalidateSession();
  }

  function handlePianoRollPointerEnter(event: PointerEvent) {
    applyPointerResult(session.handlePointerEnter(event, pianoRoll));
  }

  function handlePianoRollPointerDown(event: PointerEvent) {
    applyPointerResult(session.handlePointerDown(event, pianoRoll));
  }

  function handlePianoRollPointerMove(event: PointerEvent) {
    applyPointerResult(session.handlePointerMove(event, pianoRoll));
  }

  function handlePianoRollPointerUp(event: PointerEvent) {
    applyPointerResult(session.handlePointerUp(event, pianoRoll));
  }

  function handlePianoRollPointerLeave(event: PointerEvent) {
    applyPointerResult(session.handlePointerLeave(event, pianoRoll));
  }

  function handleNotePointerDown(event: PointerEvent, note: PianoRollNoteView) {
    applyPointerResult(session.handleNotePointerDown(event, pianoRoll, note));
  }

  function handleNotePointerMove(event: PointerEvent, note: PianoRollNoteView) {
    applyPointerResult(session.handleNotePointerMove(event, pianoRoll, note));
  }

  function handleNotePointerUp(event: PointerEvent, note: PianoRollNoteView) {
    applyPointerResult(session.handleNotePointerUp(event, pianoRoll, note));
  }

  function centerPianoRollOnMiddleC(node: HTMLDivElement) {
    pianoRollScrollElement = node;
    centerPianoRollScroll();
  }

  function centerPianoRollScroll() {
    if (!pianoRollScrollElement || !session) return;

    const middleCOffset =
      pitchToScreenY(middleCPitch, session.viewport, 127) -
      pianoRollScrollElement.clientHeight / 2;

    pianoRollScrollElement.scrollTop = Math.max(0, middleCOffset);
  }
</script>

{#if session}
  <PatternToolbar
    editors={EDITORS}
    activeEditor={activeEditor}
    tools={session.tools}
    activeToolId={session.activeTool.id}
    onEditorChange={(editor) => {
      onEditorChange(editor);
    }}
    onToolChange={(tool) => {
      session.setActiveTool(tool);
      invalidateSession();
    }}
    onAddNote={addC4Note}
    onZoomIn={() => {
      session.zoomViewportX(viewportZoomStep, pianoRoll);
      invalidateSession();
    }}
    onZoomOut={() => {
      session.zoomViewportX(1 / viewportZoomStep, pianoRoll);
      invalidateSession();
    }}
    onZoomPitchIn={() => {
      session.zoomViewportY(viewportZoomStep, pianoRoll);
      invalidateSession();
    }}
    onZoomPitchOut={() => {
      session.zoomViewportY(1 / viewportZoomStep, pianoRoll);
      invalidateSession();
    }}
    onPanLeft={() => {
      session.scrollViewport(-viewportBeatScrollStep, pianoRoll);
      invalidateSession();
    }}
    onPanRight={() => {
      session.scrollViewport(viewportBeatScrollStep, pianoRoll);
      invalidateSession();
    }}
    onPitchUp={() => {
      session.scrollPitch(-viewportPitchScrollStep, pianoRoll);
      invalidateSession();
    }}
    onPitchDown={() => {
      session.scrollPitch(viewportPitchScrollStep, pianoRoll);
      invalidateSession();
    }}
    onResetView={resetPatternViewport}
  />
{/if}

{#if session && activeEditor === 'piano-roll'}
  {#if renderModel}
    <section class="piano-roll-panel" aria-label="Piano roll">
      <div class="pane-heading">
        <h2>Piano Roll</h2>
        <span>{renderModel.patternName}</span>
      </div>

      <div
        class="piano-roll-frame"
      >
        <div
          class="piano-roll-scroll"
          bind:this={pianoRollScrollElement}
          use:centerPianoRollOnMiddleC
          on:wheel={handlePatternWheel}
        >
          <div class="piano-roll-content">
            <div class="piano-roll-ruler" aria-hidden="true">
              <span>Note</span>
              <div
                class="piano-roll-ruler-track"
                style={`width: ${patternLengthToScreenWidth(renderModel.visibleLength, renderModel.viewport)}px;`}
              >
                {#each renderModel.gridLines.filter((line) => line.label) as marker}
                  <span style={`left: ${beatToScreenX(marker.beat, renderModel.viewport)}px`}>
                    {marker.label}
                  </span>
                {/each}
              </div>
            </div>

            <div class="piano-roll-body">
              <div
                class="pitch-ruler"
                style={`height: ${pitchRangeToScreenHeight(renderModel.pitchCount, renderModel.viewport)}px;`}
                aria-hidden="true"
              >
                {#each renderModel.pitchRows as pitch}
                  <span
                    class:c-note={pitch % 12 === 0}
                    style={`top: ${pitchToScreenY(pitch, renderModel.viewport, renderModel.highestPitch) + renderModel.viewport.pixelsPerSemitone / 2}px`}
                  >
                    {noteName(pitch)}
                  </span>
                {/each}
              </div>

              <div
                class="piano-roll"
                class:panning={renderModel.isPanning}
                role="application"
                aria-label="Piano roll notes"
                style={`width: ${patternLengthToScreenWidth(renderModel.visibleLength, renderModel.viewport)}px; height: ${pitchRangeToScreenHeight(renderModel.pitchCount, renderModel.viewport)}px;`}
                on:pointerenter={handlePianoRollPointerEnter}
                on:pointerdown={handlePianoRollPointerDown}
                on:pointermove={handlePianoRollPointerMove}
                on:pointerup={handlePianoRollPointerUp}
                on:pointerleave={handlePianoRollPointerLeave}
                on:auxclick|preventDefault
              >
                <div class="piano-roll-grid" aria-hidden="true">
                  {#each renderModel.gridLines as line}
                    <span
                      class:beat-line={line.isMajor}
                      style={`left: ${beatToScreenX(line.beat, renderModel.viewport)}px`}
                    ></span>
                  {/each}

                  {#each renderModel.pitchRows as pitch}
                    <span
                      class="pitch-line"
                      style={`top: ${pitchToScreenY(pitch, renderModel.viewport, renderModel.highestPitch)}px`}
                    ></span>
                  {/each}
                </div>

                {#if renderModel.ghost && renderModel.activeToolId === 'draw-note'}
                  <div
                    class="note-ghost"
                    style={`left: ${beatToScreenX(renderModel.ghost.beat, renderModel.viewport)}px; top: ${pitchToScreenY(renderModel.ghost.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px; width: ${durationToScreenWidth(renderModel.grid.snap, renderModel.viewport)}px; height: ${renderModel.noteHeight}px;`}
                  ></div>
                {/if}

                {#each renderModel.overlayRectangles as overlay (overlay.id)}
                  <div
                    class="marquee-overlay"
                    style={`left: ${overlay.x}px; top: ${overlay.y}px; width: ${overlay.width}px; height: ${overlay.height}px;`}
                  ></div>
                {/each}

                {#each renderModel.notes as note (note.id)}
                  <button
                    type="button"
                    class="note"
                    class:selected={renderModel.selectedNoteIds.includes(note.id)}
                    class:hovered={renderModel.hoveredNoteId === note.id}
                    class:resize-active={renderModel.activeToolId === 'resize-note'}
                    aria-label={`${noteName(note.pitch)} note at beat ${note.time}`}
                    style={`left: ${beatToScreenX(note.time, renderModel.viewport)}px; width: ${durationToScreenWidth(note.duration, renderModel.viewport)}px; height: ${renderModel.noteHeight}px; top: ${pitchToScreenY(note.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px;`}
                    on:pointerdown|stopPropagation={(event) =>
                      handleNotePointerDown(event, note)}
                    on:pointermove|stopPropagation={(event) =>
                      handleNotePointerMove(event, note)}
                    on:pointerup|stopPropagation={(event) =>
                      handleNotePointerUp(event, note)}
                    on:auxclick|preventDefault
                  >
                    {#if renderModel.activeToolId === 'resize-note'}
                      <span
                        class="note-resize-handle"
                        aria-label={`Resize ${noteName(note.pitch)} note`}
                        role="presentation"
                      ></span>
                    {/if}
                  </button>
                {/each}

                {#each renderModel.overlayNotes as overlayNote (overlayNote.id)}
                  <div
                    class="note-overlay"
                    class:ghost={overlayNote.variant === 'ghost'}
                    style={`left: ${beatToScreenX(overlayNote.time, renderModel.viewport)}px; width: ${durationToScreenWidth(overlayNote.duration, renderModel.viewport)}px; height: ${renderModel.noteHeight}px; top: ${pitchToScreenY(overlayNote.pitch, renderModel.viewport, renderModel.highestPitch) + 1}px;`}
                  ></div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  {/if}
{:else if activeEditor === 'drum-rack'}
  <section class="panel">
    <h2>Drum Rack</h2>
    <p>Fixed-lane percussion editor placeholder.</p>
  </section>
{:else if activeEditor === 'pattern-grid'}
  <section class="panel">
    <h2>Pattern Grid</h2>
    <p>Mono step sequencer with per-slot pitch placeholder.</p>
  </section>
{:else if activeEditor === 'audio-graph'}
  <section class="panel">
    <h2>Audio Graph</h2>
    <p>Node-based routing and modulation placeholder.</p>
  </section>
{/if}
