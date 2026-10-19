import { type Backend } from './backend';
import type { Transport } from './transport';
export declare function createMockEnvironment(): {
    transport: Transport;
    backend: Backend;
};
