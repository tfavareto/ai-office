// Tiny DOM helpers. All text goes through textContent / text nodes, never innerHTML.

export type Child = Node | string | number | null | undefined | false;
export type PropValue = string | number | boolean | null | undefined | EventListener;
export type Props = Record<string, PropValue>;

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProp(el: Element, key: string, value: PropValue): void {
  if (value === null || value === undefined || value === false) return;
  if (typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value);
    return;
  }
  if (key === 'class') {
    el.setAttribute('class', String(value));
    return;
  }
  el.setAttribute(key, value === true ? '' : String(value));
}

export function appendChildren(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child,
    );
  }
}

/** Builds a node list from children, dropping empty ones (for replaceChildren). */
export function compact(...children: Child[]): Node[] {
  const holder = document.createDocumentFragment();
  appendChildren(holder, children);
  return Array.from(holder.childNodes);
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) for (const [key, value] of Object.entries(props)) applyProp(el, key, value);
  appendChildren(el, children);
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Node[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) for (const [key, value] of Object.entries(props)) applyProp(el, key, value);
  for (const child of children) el.appendChild(child);
  return el;
}

export function clear(node: Element | DocumentFragment): void {
  node.replaceChildren();
}

export function setText(el: Node, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggleClass(el: Element, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/** Keeps a child list in sync with `items`, reusing nodes by key and touching the DOM only where needed. */
export interface KeyedEntry<T> {
  el: HTMLElement;
  update(item: T, index: number): void;
}

export class KeyedList<T> {
  private readonly entries = new Map<string, KeyedEntry<T>>();

  constructor(
    private readonly parent: HTMLElement,
    private readonly keyOf: (item: T) => string,
    private readonly create: (item: T) => KeyedEntry<T>,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  sync(items: readonly T[]): void {
    const seen = new Set<string>();
    let cursor: ChildNode | null = this.parent.firstChild;
    items.forEach((item, index) => {
      const key = this.keyOf(item);
      seen.add(key);
      let entry = this.entries.get(key);
      if (!entry) {
        entry = this.create(item);
        this.entries.set(key, entry);
      }
      entry.update(item, index);
      if (entry.el === cursor) {
        cursor = cursor.nextSibling;
      } else {
        this.parent.insertBefore(entry.el, cursor);
      }
    });
    for (const [key, entry] of this.entries) {
      if (!seen.has(key)) {
        entry.el.remove();
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.el.remove();
    this.entries.clear();
  }
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function focusables(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((node) => node.offsetParent !== null);
}
