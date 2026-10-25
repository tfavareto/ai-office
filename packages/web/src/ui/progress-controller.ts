// State of the achievements dialog: the progress read from the server, being read, or why it could not be.
import type { Progress } from '@ai-office/shared';
import { describeError, type Backend } from '../net/backend';
import { Observable } from './observable';

export interface ProgressViewState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: Progress | null;
  /** Why the last read failed, in the user's language. */
  error: string | null;
}

const IDLE: ProgressViewState = { status: 'idle', progress: null, error: null };

export class ProgressController extends Observable<ProgressViewState> {
  private request = 0;

  constructor(private readonly backend: () => Backend) {
    super(IDLE);
  }

  /** Reads the progress. The old numbers stay on screen while the new ones come; a slow answer never replaces a newer one. */
  async load(includeProject: boolean): Promise<void> {
    const id = ++this.request;
    this.replace({ ...this.value, status: this.value.progress === null ? 'loading' : this.value.status, error: null });
    try {
      const progress = await this.backend().progress(includeProject);
      if (id === this.request) this.replace({ status: 'ready', progress, error: null });
    } catch (error) {
      if (id === this.request)
        this.replace({ status: 'error', progress: this.value.progress, error: describeError(error) });
    }
  }
}
