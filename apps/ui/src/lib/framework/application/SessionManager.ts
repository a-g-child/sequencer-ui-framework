import type { EditorSession } from '../editor/index.ts';

export class SessionManager {
  private readonly sessions = new Map<string, EditorSession>();

  get<TSession extends EditorSession>(key: string): TSession | undefined {
    return this.sessions.get(key) as TSession | undefined;
  }

  set(key: string, session: EditorSession): void {
    this.sessions.set(key, session);
  }

  remove(key: string): void {
    this.sessions.delete(key);
  }
}
