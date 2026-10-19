export type Child = Node | string | number | null | undefined | false;
export type PropValue = string | number | boolean | null | undefined | EventListener;
export type Props = Record<string, PropValue>;
export declare function appendChildren(parent: Node, children: readonly Child[]): void;
/** Builds a node list from children, dropping empty ones (for replaceChildren). */
export declare function compact(...children: Child[]): Node[];
export declare function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K];
export declare function svg<K extends keyof SVGElementTagNameMap>(tag: K, props?: Props | null, ...children: Node[]): SVGElementTagNameMap[K];
export declare function clear(node: Element | DocumentFragment): void;
export declare function setText(el: Node, text: string): void;
export declare function toggleClass(el: Element, name: string, on: boolean): void;
export declare function setAttr(el: Element, name: string, value: string | null): void;
/** Keeps a child list in sync with `items`, reusing nodes by key and touching the DOM only where needed. */
export interface KeyedEntry<T> {
    el: HTMLElement;
    update(item: T, index: number): void;
}
export declare class KeyedList<T> {
    private readonly parent;
    private readonly keyOf;
    private readonly create;
    private readonly entries;
    constructor(parent: HTMLElement, keyOf: (item: T) => string, create: (item: T) => KeyedEntry<T>);
    get size(): number;
    sync(items: readonly T[]): void;
    clear(): void;
}
export declare function isEditable(target: EventTarget | null): boolean;
export declare function focusables(root: HTMLElement): HTMLElement[];
