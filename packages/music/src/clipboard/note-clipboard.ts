export interface NoteClipboardItem {
  time: number
  duration: number
  pitch: number
  velocity: number
  probability?: number
  humanizeOffset?: number
}

export interface NoteClipboard {
  type: 'notes'
  items: NoteClipboardItem[]
  originBeat: number
}
