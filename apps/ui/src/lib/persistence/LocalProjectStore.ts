export class LocalProjectStore {
  constructor(
    private readonly storageKey = 'sequencer.project.autosave.v1'
  ) {}

  save(serializedDocument: string): void {
    localStorage.setItem(this.storageKey, serializedDocument)
  }

  load(): string | undefined {
    return localStorage.getItem(this.storageKey) ?? undefined
  }

  clear(): void {
    localStorage.removeItem(this.storageKey)
  }
}
