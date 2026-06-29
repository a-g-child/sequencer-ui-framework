import {
  AddTrackOperation,
  MovePatternPlacementOperation,
  RenameEntityOperation,
  ResizePatternPlacementOperation,
  SetParameterValueOperation,
  SetPatternPlacementLoopCountOperation,
  type BeatTime,
  type Operation,
  type ParameterValue,
  type SequencerApplication,
  type Track
} from '@sequencer/core'
import {
  CreateNoteOperation,
  DeleteNoteOperation,
  MoveNoteOperation,
  ResizeNoteOperation
} from '@sequencer/music'
import type { PlacementInspectorView } from './inspector/inspector-model'
import type { NoteInspectorView } from './inspector/inspector-model'
import type { PianoRollNoteView } from './editors/piano-roll/piano-roll-model'
import type { TimelinePlacementView } from './timeline/timeline-model'

export class AppController {
  constructor(private readonly app: SequencerApplication) {}

  selectInitialTrack(): void {
    const initialTrack = this.app.documentStore.document.tracks.values()[0]

    if (initialTrack) {
      this.selectTrack(initialTrack)
    }
  }

  playTransport(): void {
    this.app.editorTransport.play()
  }

  stopTransport(): void {
    this.app.editorTransport.stop()
  }

  setRuntimeBpm(bpm: number): boolean {
    if (!Number.isFinite(bpm) || bpm <= 0) return false

    this.app.editorTransport.setBpm(bpm)
    return true
  }

  selectTrack(track: Track): void {
    this.app.documentStore.setSelection({ type: 'track', id: track.id })
  }

  selectPlacement(placement: TimelinePlacementView): void {
    this.app.documentStore.setSelection({
      type: 'placement',
      id: placement.id,
      parentId: placement.trackId
    })
  }

  selectNote(note: PianoRollNoteView): void {
    this.app.documentStore.setSelection({
      type: 'note',
      id: note.id,
      parentId: note.patternId
    })
  }

  selectNoteById(patternId: string, noteId: string): void {
    this.app.documentStore.setSelection({
      type: 'note',
      id: noteId,
      parentId: patternId
    })
  }

  addTrack(): void {
    const store = this.app.documentStore
    const nextNumber = store.document.tracks.values().length + 1

    store.execute(
      new AddTrackOperation(`Track ${nextNumber}`, `Pattern ${nextNumber}`)
    )

    const nextTrack = store.document.tracks.values().at(-1)

    if (nextTrack) {
      this.selectTrack(nextTrack)
    }
  }

  execute(operation: Operation): void {
    this.app.documentStore.execute(operation)
  }

  renameSelectedTrack(nextName: string): boolean {
    const store = this.app.documentStore
    const selected = store.selection.current()
    const name = nextName.trim()

    if (selected?.type !== 'track' || !name) return false

    const track = store.document.tracks.find(selected.id)

    if (!track || track.name === name) return false

    store.execute(new RenameEntityOperation(store.document.tracks, track.id, name))
    return true
  }

  setParameterValue(parameterId: string, value: ParameterValue): void {
    this.app.documentStore.execute(
      new SetParameterValueOperation(parameterId, value)
    )
  }

  previewParameterValue(parameterId: string, value: number): void {
    this.app.documentStore.previewParameterValue(parameterId, value)
  }

  commitNumberValue(parameterId: string, value: number): boolean {
    const store = this.app.documentStore
    const parameter = store.document.parameters.get(parameterId)

    if (value === parameter.value) return false

    this.setParameterValue(parameterId, value)
    return true
  }

  movePlacement(placement: TimelinePlacementView, delta: BeatTime): boolean {
    const nextStart = Math.max(0, placement.start + delta)

    if (nextStart === placement.start) return false

    this.app.documentStore.execute(
      new MovePatternPlacementOperation(
        placement.trackId,
        placement.id,
        nextStart
      )
    )
    return true
  }

  resizePlacement(placement: TimelinePlacementView, delta: BeatTime): boolean {
    const nextLength = Math.max(1, placement.length + delta)

    if (nextLength === placement.length) return false

    this.app.documentStore.execute(
      new ResizePatternPlacementOperation(
        placement.trackId,
        placement.id,
        nextLength
      )
    )
    return true
  }

  setPlacementStart(
    placement: PlacementInspectorView | undefined,
    nextStart: number
  ): boolean {
    if (!placement || !Number.isFinite(nextStart)) return false

    const clampedStart = Math.max(0, nextStart)

    if (clampedStart === placement.start) return false

    this.app.documentStore.execute(
      new MovePatternPlacementOperation(
        placement.trackId,
        placement.id,
        clampedStart
      )
    )
    return true
  }

  setPlacementLength(
    placement: PlacementInspectorView | undefined,
    nextLength: number
  ): boolean {
    if (!placement || !Number.isFinite(nextLength)) return false

    const clampedLength = Math.max(0.25, nextLength)

    if (clampedLength === placement.length) return false

    this.app.documentStore.execute(
      new ResizePatternPlacementOperation(
        placement.trackId,
        placement.id,
        clampedLength
      )
    )
    return true
  }

  setPlacementLoopCount(
    placement: PlacementInspectorView | undefined,
    nextLoopCount: number
  ): boolean {
    if (!placement || !Number.isFinite(nextLoopCount)) return false

    const clampedLoopCount = Math.max(1, Math.floor(nextLoopCount))

    if (clampedLoopCount === placement.loopCount) return false

    this.app.documentStore.execute(
      new SetPatternPlacementLoopCountOperation(
        placement.trackId,
        placement.id,
        clampedLoopCount
      )
    )
    return true
  }

  createNote(
    patternId: string,
    time: BeatTime,
    duration: BeatTime,
    pitch: number
  ): void {
    const operation = new CreateNoteOperation(patternId, time, duration, pitch)

    this.app.documentStore.execute(operation)
    this.app.documentStore.setSelection({
      type: 'note',
      id: operation.note.id,
      parentId: patternId
    })
  }

  setNoteTime(note: NoteInspectorView | undefined, nextTime: number): boolean {
    if (!note || !Number.isFinite(nextTime)) return false

    const clampedTime = Math.max(0, nextTime)

    if (clampedTime === note.time) return false

    this.app.documentStore.execute(
      new MoveNoteOperation(note.patternId, note.id, clampedTime, note.pitch)
    )
    return true
  }

  setNotePitch(note: NoteInspectorView | undefined, nextPitch: number): boolean {
    if (!note || !Number.isFinite(nextPitch)) return false

    const clampedPitch = Math.min(127, Math.max(0, Math.round(nextPitch)))

    if (clampedPitch === note.pitch) return false

    this.app.documentStore.execute(
      new MoveNoteOperation(note.patternId, note.id, note.time, clampedPitch)
    )
    return true
  }

  setNoteDuration(
    note: NoteInspectorView | undefined,
    nextDuration: number
  ): boolean {
    if (!note || !Number.isFinite(nextDuration)) return false

    const clampedDuration = Math.max(0.25, nextDuration)

    if (clampedDuration === note.duration) return false

    this.app.documentStore.execute(
      new ResizeNoteOperation(note.patternId, note.id, clampedDuration)
    )
    return true
  }

  deleteNote(note: NoteInspectorView | undefined): boolean {
    if (!note) return false

    this.app.documentStore.execute(
      new DeleteNoteOperation(note.patternId, note.id)
    )
    this.app.documentStore.clearSelection()
    return true
  }

  undo(): void {
    this.app.documentStore.undo()
  }

  redo(): void {
    this.app.documentStore.redo()
  }
}
