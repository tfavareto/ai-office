import { describe, expect, it } from 'vitest';
import { parseUsageDetail } from './parse-usage';

const totals = { input: 1, output: 2, cacheWrite: 3, cacheRead: 4, tokens: 6, costUSD: 0.5 };

describe('parseUsageDetail', () => {
  it('reads a complete response', () => {
    // Arrange
    const raw = {
      account: 'all',
      period: 'week',
      generatedAt: 10,
      range: { start: 1, end: 2, previousStart: 0, previousEnd: 1 },
      granularity: 'day',
      totals,
      previous: totals,
      series: [{ start: 1, end: 2, ...totals }],
      byModel: [{ model: 'claude-opus-5-5', ...totals }],
      byProject: [{ project: '/p', name: 'p', ...totals }],
      bySession: [
        {
          account: 'a',
          session: 's',
          agent: 'ag',
          project: '/p',
          projectName: 'p',
          lastAt: 5,
          officeId: 'a:s:ag',
          title: 'T',
          role: 'Explore',
          ...totals,
        },
      ],
      sessionCount: 9,
      windows: [{ account: 'a', start: 1, resetsAt: 2, tokens: 3, costUSD: 4, active: true }],
      progress: { state: 'indexing', percent: 42.5, filesDone: 1, filesTotal: 2 },
      demo: true,
    };
    // Act
    const detail = parseUsageDetail(raw);
    // Assert
    expect(detail).toMatchObject({ account: 'all', period: 'week', granularity: 'day', sessionCount: 9, demo: true });
    expect(detail.byModel[0]).toMatchObject({ family: 'opus', tokens: 6 });
    expect(detail.bySession[0]).toMatchObject({ agent: 'ag', officeId: 'a:s:ag', title: 'T', role: 'Explore' });
    expect(detail.progress).toEqual({ state: 'indexing', percent: 42.5, filesDone: 1, filesTotal: 2 });
  });

  it('never trusts the numbers: wrong types become zero and percentages are bounded', () => {
    const detail = parseUsageDetail({
      account: 'a',
      period: 'today',
      totals: { tokens: 'lots', costUSD: Number.NaN },
      progress: { state: 'indexing', percent: 900 },
      series: [null, 4, { start: 'x' }],
    });
    expect(detail.totals).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0, costUSD: 0 });
    expect(detail.progress.percent).toBe(100);
    expect(detail.series).toHaveLength(1);
    expect(detail.series[0]?.start).toBe(0);
    expect(detail.granularity).toBe('day');
  });

  it.each([null, 'x', [], { account: 'a' }, { account: 'a', period: 'year' }, { period: 'today' }])(
    'rejects %j',
    (raw) => {
      expect(() => parseUsageDetail(raw)).toThrow();
    },
  );
});
