export declare class Watchers {
    private readonly onChange;
    private readonly active;
    constructor(onChange: () => void);
    add(path: string): void;
    remove(path: string): void;
    closeAll(): void;
}
