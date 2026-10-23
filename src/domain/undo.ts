/** A reversible command stack used by the dungeon editor. */
export interface UndoableCommand {
  label: string;
  do: () => void | Promise<void>;
  undo: () => void | Promise<void>;
}

export class UndoStack {
  private past: UndoableCommand[] = [];
  private future: UndoableCommand[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  async execute(command: UndoableCommand): Promise<void> {
    await command.do();
    this.past.push(command);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.emit();
  }

  /** Records a command whose effect has already happened (for example a finished drag). */
  record(command: UndoableCommand): void {
    this.past.push(command);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.emit();
  }

  async undo(): Promise<string | null> {
    const command = this.past.pop();
    if (!command) return null;
    await command.undo();
    this.future.push(command);
    this.emit();
    return command.label;
  }

  async redo(): Promise<string | null> {
    const command = this.future.pop();
    if (!command) return null;
    await command.do();
    this.past.push(command);
    this.emit();
    return command.label;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.emit();
  }
}
