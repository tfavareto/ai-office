import './styles/index.css';
import { Store } from './net/store';
import { App } from './ui/app';
import { WorldHost } from './ui/world-host';
interface AiOfficeDebug {
    store: Store;
    app: App;
    world: WorldHost;
    debug(): Record<string, unknown>;
}
declare global {
    interface Window {
        aiOffice?: AiOfficeDebug;
    }
}
export {};
