import { describe, expect, it, vi } from 'vitest';
import { MAX_LOG_ENTRIES, MAX_RULES, RuleBook } from './rule-book';
import { PROJECT, bash } from './fixtures';

const NOON = Date.parse('2026-10-19T15:00:00');

function makeBook(initial?: ConstructorParameters<typeof RuleBook>[1]) {
  let ids = 0;
  let clock = NOON;
  const onChange = vi.fn();
  const book = new RuleBook({ now: () => clock, newId: () => `id${++ids}`, onChange }, initial);
  return { book, onChange, tick: (ms: number) => (clock += ms) };
}

const draft = (value: string, extra: Record<string, unknown> = {}) => ({
  effect: 'allow',
  tool: 'Bash',
  matcher: { kind: 'command-prefix', value },
  ...extra,
});
const asker = { agentId: 'ag1', agentName: 'Ana' };

describe('RuleBook: rules', () => {
  it('creates, updates and removes rules', () => {
    const { book, onChange } = makeBook();
    const created = book.create(draft('npm test'));
    expect(created).toMatchObject({ ok: true, value: { id: 'id1', hits: 0, enabled: true, createdAt: NOON } });
    expect(book.update('id1', { enabled: false })).toMatchObject({ ok: true, value: { enabled: false, id: 'id1' } });
    expect(book.rules()).toHaveLength(1);
    expect(book.remove('id1')).toBe(true);
    expect(book.remove('id1')).toBe(false);
    expect(onChange).toHaveBeenCalledWith('rules');
  });

  it('refuses invalid, duplicate and unknown rules', () => {
    const { book } = makeBook();
    expect(book.create(draft('rm -rf'))).toMatchObject({ ok: false, error: { code: 'matcher-dangerous' } });
    expect(book.create(draft('npm test')).ok).toBe(true);
    expect(book.create(draft('npm test'))).toMatchObject({ ok: false, error: { code: 'duplicate-rule' } });
    expect(book.update('nope', {})).toMatchObject({ ok: false, error: { code: 'not-found' } });
    const other = book.create(draft('npm run build'));
    expect(
      book.update(other.ok ? other.value.id : '', { matcher: { kind: 'command-prefix', value: 'npm test' } }),
    ).toMatchObject({ ok: false, error: { code: 'duplicate-rule' } });
  });

  it('caps the number of rules', () => {
    const { book } = makeBook();
    for (let i = 0; i < MAX_RULES; i++) expect(book.create(draft(`tool${i} run`)).ok).toBe(true);
    expect(book.create(draft('one more'))).toMatchObject({ ok: false, error: { code: 'too-many-rules' } });
  });
});

describe('RuleBook: decisions and log', () => {
  it('answers, counts the hit and logs the decision', () => {
    const { book, tick } = makeBook();
    book.create(draft('npm test'));
    tick(5000);
    const decision = book.decide({ ...bash('npm test -- --watch'), ...asker });
    expect(decision).toMatchObject({
      kind: 'allow',
      entry: {
        outcome: 'allow',
        subject: 'npm test -- --watch',
        agentName: 'Ana',
        requestTool: 'Bash',
        projectPath: PROJECT,
      },
    });
    expect(book.rules()[0]).toMatchObject({ hits: 1, lastHitAt: NOON + 5000 });
    expect(book.log()).toHaveLength(1);
  });

  it('does not touch anything for an unmatched request', () => {
    const { book } = makeBook();
    book.create(draft('npm test'));
    expect(book.decide({ ...bash('ls'), ...asker })).toEqual({ kind: 'none' });
    expect(book.log()).toHaveLength(0);
    expect(book.rules()[0]?.hits).toBe(0);
  });

  it('logs a risky request an allow rule matched as "ask", without counting a hit', () => {
    const { book } = makeBook();
    book.create(draft('npm test'));
    book.create({ effect: 'deny', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'zzz' } });
    const raw = book.decide({ ...bash('npm test'), ...asker, input: { command: 'npm test' } });
    expect(raw.kind).toBe('allow');
    // Hand-made stored rule that is too broad: the safety net still stops the risky request.
    const { book: loose } = makeBook({
      rules: [
        {
          id: 'x1',
          effect: 'allow',
          tool: 'Bash',
          matcher: { kind: 'any', value: '' },
          scope: {},
          enabled: true,
          createdAt: 1,
          hits: 0,
        },
      ],
    });
    const asked = loose.decide({ ...bash('sudo reboot'), ...asker });
    expect(asked).toMatchObject({ kind: 'ask', entry: { outcome: 'ask', blockedBy: 'sudo' } });
    expect(loose.rules()[0]?.hits).toBe(0);
  });

  it('keeps the newest 500 entries, newest first, and clears on request', () => {
    const { book, tick } = makeBook();
    book.create(draft('ls'));
    for (let i = 0; i < MAX_LOG_ENTRIES + 20; i++) {
      tick(1);
      book.decide({ ...bash(`ls ${i}`), ...asker });
    }
    const log = book.log();
    expect(log).toHaveLength(MAX_LOG_ENTRIES);
    expect(log[0]?.subject).toBe(`ls ${MAX_LOG_ENTRIES + 19}`);
    expect(book.log(3)).toHaveLength(3);
    book.clearLog();
    expect(book.log()).toEqual([]);
  });

  it('marks demo entries', () => {
    const { book } = makeBook();
    book.create(draft('ls'));
    expect(book.decide({ ...bash('ls'), ...asker, demo: true })).toMatchObject({ entry: { demo: true } });
  });
});

describe('RuleBook: preview', () => {
  it('counts the requests of today a rule would have answered', () => {
    const { book } = makeBook();
    for (const command of ['npm test', 'npm test -- -u', 'npm install', 'sudo npm test', 'npm test; ls'])
      book.decide({ ...bash(command), ...asker });
    expect(book.preview(draft('npm test'))).toMatchObject({ ok: true, value: { matches: 2, total: 5 } });
  });

  it('forgets yesterday', () => {
    const { book, tick } = makeBook();
    book.decide({ ...bash('npm test'), ...asker });
    tick(24 * 3_600_000);
    expect(book.preview(draft('npm test'))).toMatchObject({ ok: true, value: { matches: 0, total: 0 } });
  });

  it('explains why a draft is refused', () => {
    const { book } = makeBook();
    expect(book.preview(draft('git push'))).toMatchObject({ ok: false, error: { code: 'matcher-dangerous' } });
  });
});
