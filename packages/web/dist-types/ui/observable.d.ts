export type Unsubscribe = () => void;
export declare class Observable<T> {
    protected value: T;
    private readonly listeners;
    constructor(value: T);
    get(): T;
    protected replace(next: T): void;
    subscribe(listener: (value: T) => void): Unsubscribe;
}
