// Event listeners a view adds to things it does not own (the window, the document): kept so the view can remove all
// of them when it is disposed, and a rebuilt view does not leave the old one reacting next to it.
export class Listeners {
  private readonly added: { target: EventTarget; type: string; listener: EventListener }[] = [];

  on<E extends Event>(target: EventTarget, type: string, listener: (event: E) => void): void {
    const wrapped = listener as EventListener;
    this.added.push({ target, type, listener: wrapped });
    target.addEventListener(type, wrapped);
  }

  /** How many are attached (for tests). */
  get size(): number {
    return this.added.length;
  }

  removeAll(): void {
    for (const { target, type, listener } of this.added.splice(0)) target.removeEventListener(type, listener);
  }
}
