import { describe, expect, test } from 'vitest';
import { parseNote, parseResumableTerminals, parseRoutines } from './parse-routines';

const valid = {
  id: 'r1',
  name: 'Tests',
  prompt: 'Run the tests',
  projectPath: '/w/p',
  schedule: { kind: 'interval', minutes: 10 },
  enabled: true,
  nextRunAt: 5,
  history: [{ at: 1, outcome: 'sent' }, { at: 2, outcome: 'unknown' }, 7],
};

describe('parseRoutines', () => {
  test('keeps a valid routine and only the runs it can name', () => {
    // Act
    const [routine] = parseRoutines({ routines: [valid] });

    // Assert
    expect(routine?.schedule).toEqual({ kind: 'interval', minutes: 10 });
    expect(routine?.history).toEqual([{ at: 1, outcome: 'sent' }]);
  });

  test('reads a daily schedule', () => {
    const schedule = { kind: 'daily', hour: 9, minute: 30 };
    expect(parseRoutines({ routines: [{ ...valid, schedule }] })[0]?.schedule).toEqual(schedule);
  });

  test('drops what is malformed', () => {
    expect(parseRoutines({ routines: [{ ...valid, id: 7 }, { ...valid, schedule: { kind: 'cron' } }, 'x'] })).toEqual(
      [],
    );
    expect(parseRoutines(null)).toEqual([]);
  });
});

describe('parseNote', () => {
  test('reads a note, and anything else as an empty one', () => {
    expect(parseNote({ text: 'Plan', updatedAt: 3 })).toEqual({ text: 'Plan', updatedAt: 3 });
    expect(parseNote({ text: 3 })).toEqual({ text: '', updatedAt: 0 });
    expect(parseNote(null)).toEqual({ text: '', updatedAt: 0 });
  });
});

describe('parseResumableTerminals', () => {
  test('keeps what can be offered and drops the rest', () => {
    // Arrange
    const data = { sessions: [{ sessionId: 's', cwd: '/w', role: 'Revisor' }, { sessionId: 's' }, 3] };

    // Act and assert
    expect(parseResumableTerminals(data)).toEqual([{ sessionId: 's', cwd: '/w', role: 'Revisor' }]);
    expect(parseResumableTerminals('nope')).toEqual([]);
  });
});
