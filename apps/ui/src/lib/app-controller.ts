import {
  AddTrackOperation,
  CompositeOperation,
  CreateClipForTrackOperation,
  AddAssetOperation,
  AddDeviceInstanceOperation,
  DeleteClipOperation,
  MovePatternPlacementOperation,
  RenameEntityOperation,
  RenameClipOperation,
  ResizeMidiClipOperation,
  ResizePatternPlacementOperation,
  SetMidiClipLoopOperation,
  SetMidiClipLoopRegionOperation,
  SetDeviceParameterValueOperation,
  SetParameterValueOperation,
  SetSamplerSampleSlotOperation,
  SetTrackDeviceOperation,
  SetPatternPlacementLoopOperation,
  SetPatternPlacementLoopCountOperation,
  SetPatternPlacementLoopRegionOperation,
  type BeatTime,
  type Operation,
  type ParameterValue,
  type SequencerApplication,
  type Track
} from '@sequencer/core'
import type { AssetReference } from '@sequencer/assets'
import type { DeviceInstance, DeviceParameterValue, SampleSlot } from '@sequencer/device'
import {
  CreateNoteOperation,
  CreateNotesOperation,
  DeleteNoteOperation,
  DeleteNotesOperation,
  MoveNoteOperation,
  ResizeNoteOperation,
  SetPatternAutomationOperation,
  type CreateNoteInput,
  type NoteClipboard,
  type NoteClipboardItem
} from '@sequencer/music'
import type { PlacementInspectorView } from './inspector/inspector-model'
import type { NoteInspectorView } from './inspector/inspector-model'
import type { PianoRollNoteView } from './editors/piano-roll/piano-roll-model'
import type { TimelinePlacementView } from './timeline/timeline-model'

export type ClipLoopRegion = {
  clipStart: BeatTime
  clipLength: BeatTime
  loopStart: BeatTime
  loopLength: BeatTime
}

export type TrackClipView = {
  id: string
  slotId: string
  trackId: string
  patternId: string
  name: string
  slotIndex: number
  active: boolean
  playbackActive: boolean
  pendingLaunch: boolean
  launchAtBeat: number | undefined
}

export type PatternAutomationPoint = {
  beat: BeatTime
  value: number
}

export class AppController {
  constructor(private readonly app: SequencerApplication) {}

  get store() {
    return this.app.documentStore
  }

  get transportBeat(): BeatTime {
    return this.app.editorTransport.currentBeat
  }

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

  selectNotes(patternId: string, noteIds: string[]): void {
    if (noteIds.length === 0) {
      this.app.documentStore.clearSelection()
      return
    }

    this.app.documentStore.setSelection({
      type: 'note',
      id: noteIds[0],
      parentId: patternId,
      ids: noteIds
    })
  }

  copyNotes(notes: PianoRollNoteView[]): boolean {
    if (notes.length === 0) return false

    const originBeat = Math.min(...notes.map((note) => note.time))
    const payload: NoteClipboard = {
      type: 'notes',
      originBeat,
      items: notes.map((note) => ({
        time: note.time,
        duration: note.duration,
        pitch: note.pitch,
        velocity: note.velocity,
        probability: note.probability,
        humanizeOffset: note.humanizeOffset
      }))
    }

    this.app.documentStore.setClipboardPayload(payload)
    return true
  }

  pasteNotes(patternId: string, target: PasteTarget): boolean {
    const payload =
      this.app.documentStore.clipboard.getPayload<NoteClipboard>()

    if (!payload || payload.type !== 'notes' || payload.items.length === 0) {
      return false
    }

    return this.createNotesFromClipboard(patternId, payload, target.beat)
  }

  duplicateNotes(patternId: string, notes: PianoRollNoteView[]): boolean {
    if (!this.copyNotes(notes)) return false

    const originBeat = Math.min(...notes.map((note) => note.time))
    const duplicateBeat = originBeat + this.duplicateOffset(notes)
    const payload =
      this.app.documentStore.clipboard.getPayload<NoteClipboard>()

    if (!payload) return false

    return this.createNotesFromClipboard(patternId, payload, duplicateBeat)
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

  setDeviceParameterValue(
    deviceInstanceId: string,
    parameterKey: string,
    value: DeviceParameterValue
  ): void {
    this.app.documentStore.execute(
      new SetDeviceParameterValueOperation(deviceInstanceId, parameterKey, value)
    )
  }

  addAsset(asset: AssetReference): void {
    this.app.documentStore.execute(new AddAssetOperation(asset))
  }

  addDeviceInstance(device: DeviceInstance): void {
    this.app.documentStore.execute(new AddDeviceInstanceOperation(device))
  }

  setTrackDevice(trackId: string, deviceInstanceId: string | undefined): void {
    this.app.documentStore.execute(
      new SetTrackDeviceOperation(trackId, deviceInstanceId)
    )
  }

  setSamplerSampleSlot(deviceInstanceId: string, slot: SampleSlot): void {
    this.app.documentStore.execute(
      new SetSamplerSampleSlotOperation(deviceInstanceId, slot)
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

  setPatternClipLoop(patternId: string | undefined, loop: boolean): boolean {
    if (!patternId) return false

    const placement = this.findFirstPlacementForPattern(patternId)

    if (!placement || (placement.placement.loop ?? true) === loop) return false

    this.app.documentStore.execute(
      new SetPatternPlacementLoopOperation(
        placement.trackId,
        placement.placement.id,
        loop
      )
    )
    return true
  }

  setMidiClipLoop(clipId: string | undefined, loop: boolean): boolean {
    if (!clipId) return false

    const clip = this.app.documentStore.document.midiClips.find(clipId)

    if (!clip || clip.loopEnabled === loop) return false

    this.app.documentStore.execute(new SetMidiClipLoopOperation(clipId, loop))
    return true
  }

  setPatternClipLoopRegion(
    patternId: string | undefined,
    loopStart: number,
    loopLength: number
  ): boolean {
    if (!patternId || !Number.isFinite(loopStart) || !Number.isFinite(loopLength)) {
      return false
    }

    const placement = this.findFirstPlacementForPattern(patternId)

    if (!placement) return false

    const clipLength = this.patternClipLength(patternId, placement.placement.length)
    const nextLoopStart = Math.min(Math.max(0, loopStart), Math.max(0, clipLength - 0.25))
    const nextLoopLength = Math.min(
      Math.max(0.25, loopLength),
      Math.max(0.25, clipLength - nextLoopStart)
    )
    const current = this.patternClipLoopRegion(patternId)

    if (
      current.loopStart === nextLoopStart &&
      current.loopLength === nextLoopLength
    ) {
      return false
    }

    this.app.documentStore.execute(
      new SetPatternPlacementLoopRegionOperation(
        placement.trackId,
        placement.placement.id,
        nextLoopStart,
        nextLoopLength
      )
    )
    return true
  }

  setMidiClipLoopRegion(
    clipId: string | undefined,
    loopStart: number,
    loopLength: number
  ): boolean {
    if (!clipId || !Number.isFinite(loopStart) || !Number.isFinite(loopLength)) {
      return false
    }

    const clip = this.app.documentStore.document.midiClips.find(clipId)

    if (!clip) return false

    const clipLength = Math.max(0.25, clip.length)
    const nextLoopStart = Math.min(Math.max(0, loopStart), Math.max(0, clipLength - 0.25))
    const nextLoopLength = Math.min(
      Math.max(0.25, loopLength),
      Math.max(0.25, clipLength - nextLoopStart)
    )

    if (
      clip.loopStart === nextLoopStart &&
      clip.loopLength === nextLoopLength
    ) {
      return false
    }

    this.app.documentStore.execute(
      new SetMidiClipLoopRegionOperation(
        clipId,
        nextLoopStart,
        nextLoopLength
      )
    )
    return true
  }

  setPatternClipBounds(
    patternId: string | undefined,
    clipStart: number,
    clipLength: number
  ): boolean {
    if (!patternId || !Number.isFinite(clipStart) || !Number.isFinite(clipLength)) {
      return false
    }

    const placement = this.findFirstPlacementForPattern(patternId)

    if (!placement) return false

    const nextClipStart = Math.max(0, clipStart)
    const nextClipLength = Math.max(0.25, clipLength)
    const currentRegion = this.patternClipLoopRegion(patternId)

    if (
      currentRegion.clipStart === nextClipStart &&
      currentRegion.clipLength === nextClipLength
    ) {
      return false
    }

    const nextLoopStart = Math.min(
      currentRegion.loopStart,
      Math.max(0, nextClipLength - 0.25)
    )
    const nextLoopLength = Math.min(
      currentRegion.loopLength,
      Math.max(0.25, nextClipLength - nextLoopStart)
    )
    const operation = new CompositeOperation('Set Pattern Clip Bounds')

    operation
      .add(
        new MovePatternPlacementOperation(
          placement.trackId,
          placement.placement.id,
          nextClipStart
        )
      )
      .add(
        new ResizePatternPlacementOperation(
          placement.trackId,
          placement.placement.id,
          nextClipLength
        )
      )

    if (
      currentRegion.loopStart !== nextLoopStart ||
      currentRegion.loopLength !== nextLoopLength
    ) {
      operation.add(
        new SetPatternPlacementLoopRegionOperation(
          placement.trackId,
          placement.placement.id,
          nextLoopStart,
          nextLoopLength
        )
      )
    }

    this.app.documentStore.execute(operation)
    return true
  }

  setMidiClipBounds(
    clipId: string | undefined,
    clipLength: number
  ): boolean {
    if (!clipId || !Number.isFinite(clipLength)) {
      return false
    }

    const clip = this.app.documentStore.document.midiClips.find(clipId)

    if (!clip) return false

    const nextClipLength = Math.max(0.25, clipLength)

    if (clip.length === nextClipLength) {
      return false
    }

    const nextLoopStart = Math.min(
      clip.loopStart,
      Math.max(0, nextClipLength - 0.25)
    )
    const nextLoopLength = Math.min(
      clip.loopLength,
      Math.max(0.25, nextClipLength - nextLoopStart)
    )
    const operation = new CompositeOperation('Set MIDI Clip Bounds')

    operation.add(new ResizeMidiClipOperation(clipId, nextClipLength))

    if (
      clip.loopStart !== nextLoopStart ||
      clip.loopLength !== nextLoopLength
    ) {
      operation.add(
        new SetMidiClipLoopRegionOperation(
          clipId,
          nextLoopStart,
          nextLoopLength
        )
      )
    }

    this.app.documentStore.execute(operation)
    return true
  }

  isPatternClipLooping(patternId: string | undefined): boolean {
    if (!patternId) return true

    const placement = this.findFirstPlacementForPattern(patternId)

    if (placement) return placement.placement.loop ?? true

    return this.findFirstClipForPattern(patternId)?.loopEnabled ?? true
  }

  clipIdForPattern(patternId: string | undefined): string | undefined {
    if (!patternId) return undefined

    const clip = this.app.documentStore.document.midiClips
      .values()
      .find((candidate) => candidate.pattern === patternId)

    return clip?.id
  }

  patternIdForClip(clipId: string | undefined): string | undefined {
    if (!clipId) return undefined

    return this.app.documentStore.document.midiClips.find(clipId)?.pattern
  }

  trackClips(
    trackId: string | undefined,
    activeClipId: string | undefined,
    playbackActiveClipId: string | undefined,
    pendingLaunch: { readonly clipId: string; readonly launchAtBeat: number } | undefined
  ): TrackClipView[] {
    if (!trackId) return []

    const document = this.app.documentStore.document
    const track = document.tracks.find(trackId)

    if (!track) return []

    return [...track.clips]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .flatMap((slot): TrackClipView[] => {
        const clip = document.midiClips.find(slot.target)

        if (!clip) return []

        return [
          {
            id: clip.id,
            slotId: slot.id,
            trackId: track.id,
            patternId: clip.pattern,
            name: slot.name || clip.name,
            slotIndex: slot.slotIndex,
            active: clip.id === activeClipId,
            playbackActive: clip.id === playbackActiveClipId,
            pendingLaunch: pendingLaunch?.clipId === clip.id,
            launchAtBeat:
              pendingLaunch?.clipId === clip.id
                ? pendingLaunch.launchAtBeat
                : undefined
          }
        ]
      })
  }

  createClipForTrack(
    trackId: string | undefined,
    slotIndex?: number
  ): string | undefined {
    if (!trackId) return undefined

    const track = this.app.documentStore.document.tracks.find(trackId)

    if (!track) return undefined

    const clipName = `Clip ${(slotIndex ?? track.clips.length) + 1}`
    const operation = new CreateClipForTrackOperation(
      trackId,
      clipName,
      4,
      slotIndex
    )

    this.app.documentStore.execute(operation)
    return operation.clip.id
  }

  deleteClip(clipId: string | undefined): boolean {
    if (!clipId || !this.app.documentStore.document.midiClips.find(clipId)) {
      return false
    }

    this.app.documentStore.execute(new DeleteClipOperation(clipId))
    return true
  }

  renameClip(clipId: string | undefined, nextName: string): boolean {
    const name = nextName.trim()

    if (!clipId || !name) return false

    const clip = this.app.documentStore.document.midiClips.find(clipId)

    if (!clip || clip.name === name) return false

    this.app.documentStore.execute(new RenameClipOperation(clipId, name))
    return true
  }

  patternAutomationPoints(
    patternId: string | undefined,
    parameterId: string | undefined
  ): PatternAutomationPoint[] {
    if (!patternId || !parameterId) return []

    const pattern = this.app.documentStore.document.patterns.find(patternId)

    if (!pattern) return []

    return pattern.events
      .filter(
        (event) =>
          event.target === parameterId &&
          (event.type === 'set' || event.type === 'ramp') &&
          typeof event.value === 'number'
      )
      .map((event) => ({
        beat: event.time,
        value: event.value as number
      }))
      .sort((left, right) => left.beat - right.beat)
  }

  setPatternAutomationPoints(
    patternId: string | undefined,
    parameterId: string | undefined,
    points: readonly PatternAutomationPoint[]
  ): boolean {
    if (!patternId || !parameterId) return false

    const pattern = this.app.documentStore.document.patterns.find(patternId)

    if (!pattern) return false

    this.app.documentStore.execute(
      new SetPatternAutomationOperation(patternId, parameterId, points)
    )
    return true
  }

  patternClipLoopRegion(patternId: string | undefined): ClipLoopRegion {
    if (!patternId) {
      return { clipStart: 0, clipLength: 0, loopStart: 0, loopLength: 0 }
    }

    const placement = this.findFirstPlacementForPattern(patternId)

    if (!placement) {
      const clip = this.findFirstClipForPattern(patternId)

      if (!clip) {
        return { clipStart: 0, clipLength: 0, loopStart: 0, loopLength: 0 }
      }

      const clipLength = Math.max(0.25, clip.length)
      const loopStart = Math.min(
        Math.max(0, clip.loopStart),
        Math.max(0, clipLength)
      )
      const loopLength = Math.min(
        Math.max(0.25, clip.loopLength),
        Math.max(0.25, clipLength - loopStart)
      )

      return { clipStart: 0, clipLength, loopStart, loopLength }
    }

    const clipLength = this.patternClipLength(patternId, placement.placement.length)
    const loopStart = Math.min(
      Math.max(0, placement.placement.loopStart ?? 0),
      Math.max(0, clipLength)
    )
    const loopLength = Math.min(
      Math.max(0.25, placement.placement.loopLength ?? clipLength),
      Math.max(0.25, clipLength - loopStart)
    )

    return {
      clipStart: placement.placement.start,
      clipLength,
      loopStart,
      loopLength
    }
  }

  midiClipLoopRegion(clipId: string | undefined): ClipLoopRegion {
    if (!clipId) {
      return { clipStart: 0, clipLength: 0, loopStart: 0, loopLength: 0 }
    }

    const clip = this.app.documentStore.document.midiClips.find(clipId)

    if (!clip) {
      return { clipStart: 0, clipLength: 0, loopStart: 0, loopLength: 0 }
    }

    const clipLength = Math.max(0.25, clip.length)
    const loopStart = Math.min(
      Math.max(0, clip.loopStart),
      Math.max(0, clipLength)
    )
    const loopLength = Math.min(
      Math.max(0.25, clip.loopLength),
      Math.max(0.25, clipLength - loopStart)
    )

    return { clipStart: 0, clipLength, loopStart, loopLength }
  }

  private findFirstPlacementForPattern(patternId: string) {
    for (const track of this.app.documentStore.document.tracks.values()) {
      const placement = track.placements.find(
        (candidate) => candidate.target === patternId
      )

      if (placement) {
        return { trackId: track.id, placement }
      }
    }

    return undefined
  }

  private findFirstClipForPattern(patternId: string) {
    return this.app.documentStore.document.midiClips
      .values()
      .find((clip) => clip.pattern === patternId)
  }

  private patternClipLength(patternId: string, placementLength: number | undefined): number {
    return (
      placementLength ??
      this.findFirstClipForPattern(patternId)?.length ??
      this.app.documentStore.document.patterns.get(patternId).length
    )
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

  deleteSelectedNotes(): boolean {
    const store = this.app.documentStore
    const selection = store.selection.current()

    if (!selection || selection.type !== 'note' || !selection.parentId) {
      return false
    }

    const noteIds = selection.ids?.length ? selection.ids : [selection.id]

    store.execute(new DeleteNotesOperation(selection.parentId, noteIds))
    store.clearSelection()
    return true
  }

  undo(): void {
    this.app.documentStore.undo()
  }

  redo(): void {
    this.app.documentStore.redo()
  }

  private createNotesFromClipboard(
    patternId: string,
    payload: NoteClipboard,
    targetBeat: number
  ): boolean {
    const offset = Math.max(0, targetBeat) - payload.originBeat
    const notes = payload.items.map((item) =>
      this.toCreateNoteInput(item, offset)
    )
    const operation = new CreateNotesOperation(patternId, notes)

    this.app.documentStore.execute(operation)
    this.selectNotes(
      patternId,
      operation.notes.map((note) => note.id)
    )
    return true
  }

  private toCreateNoteInput(
    item: NoteClipboardItem,
    offset: number
  ): CreateNoteInput {
    return {
      time: Math.max(0, item.time + offset),
      duration: item.duration,
      pitch: item.pitch,
      velocity: item.velocity,
      probability: item.probability ?? 1,
      humanizeOffset: item.humanizeOffset ?? 0
    }
  }

  private duplicateOffset(notes: PianoRollNoteView[]): number {
    const earliestBeat = Math.min(...notes.map((note) => note.time))
    const latestBeat = Math.max(
      ...notes.map((note) => note.time + note.duration)
    )

    return Math.max(0.25, latestBeat - earliestBeat)
  }
}

export type PasteTarget = {
  beat: BeatTime
  pitch?: number
}
