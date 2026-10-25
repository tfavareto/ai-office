// The customization as the server has it, for the editors and the settings manager. Every change goes to the server
// and the answer (the whole document) replaces what is held here; the office itself updates through the snapshot.
import { type Customization, emptyCustomization } from '@ai-office/shared';
import { type Backend, describeError } from '../net/backend';
import { Observable } from './observable';

export type CustomizationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CustomizationData {
  status: CustomizationStatus;
  error: string;
  document: Customization;
  /** A change is being sent. */
  busy: boolean;
}

/** Outcome of a change: the explanation (already in the user's language) when it failed. */
export type ChangeOutcome = { ok: true } | { ok: false; message: string };

const INITIAL: CustomizationData = { status: 'idle', error: '', document: emptyCustomization(), busy: false };

export class CustomizationController extends Observable<CustomizationData> {
  private loadToken = 0;

  constructor(private readonly backend: () => Backend) {
    super(INITIAL);
  }

  private patchState(change: Partial<CustomizationData>): void {
    this.replace({ ...this.value, ...change });
  }

  /** Reads the document; `quiet` keeps what is shown while it loads. */
  async load(quiet = false): Promise<void> {
    const token = ++this.loadToken;
    if (!quiet) this.patchState({ status: 'loading', error: '' });
    try {
      const document = await this.backend().customization();
      if (token !== this.loadToken) return;
      this.patchState({ status: 'ready', error: '', document });
    } catch (error) {
      if (token !== this.loadToken) return;
      if (quiet && this.value.status === 'ready') return;
      this.patchState({ status: 'error', error: describeError(error) });
    }
  }

  /** Sends a merge patch (`null` resets a key). */
  async change(patch: object): Promise<ChangeOutcome> {
    return this.send(() => this.backend().patchCustomization(patch));
  }

  /** Back to the defaults for everything ("Restaurar tudo"). */
  async resetAll(): Promise<ChangeOutcome> {
    return this.send(() => this.backend().resetCustomization());
  }

  private async send(request: () => Promise<Customization>): Promise<ChangeOutcome> {
    this.patchState({ busy: true });
    try {
      const document = await request();
      this.loadToken++;
      this.patchState({ busy: false, status: 'ready', error: '', document });
      return { ok: true };
    } catch (error) {
      this.patchState({ busy: false });
      return { ok: false, message: describeError(error) };
    }
  }
}
