import { describe, expect, test } from 'vitest';
import { T0, assistantLine, text, userLine } from '../test-helpers';
import { parseUsageLine } from './usage-line';

describe('parseUsageLine', () => {
  test('reads the numbers, model, message id and working directory of an assistant line', () => {
    // Arrange
    const raw = assistantLine([text('x')], 1000, { id: 'msg_a', model: 'claude-opus-5-5', usage: { input_tokens: 7, output_tokens: 9, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000 } });
    // Act
    const sample = parseUsageLine(raw);
    // Assert
    expect(sample).toEqual({
      at: T0 + 1000,
      messageId: 'msg_a',
      model: 'claude-opus-5-5',
      usage: { input: 7, output: 9, cacheWrite5m: 100, cacheWrite1h: 0, cacheRead: 5000 },
      cwd: '/work/proj',
    });
  });

  test('splits cache writes by lifetime when the line says so', () => {
    const raw = assistantLine([text('x')], 0, { usage: { input_tokens: 1, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 } } });
    expect(parseUsageLine(raw)?.usage).toMatchObject({ cacheWrite5m: 60, cacheWrite1h: 40 });
  });

  test('ignores lines that are not assistant messages with usage', () => {
    expect(parseUsageLine(userLine('hello', 0))).toBeUndefined();
    expect(parseUsageLine('')).toBeUndefined();
    expect(parseUsageLine('{"type":"assistant","usage":')).toBeUndefined();
    expect(parseUsageLine('not json "usage" "type":"assistant"')).toBeUndefined();
  });

  test('ignores synthetic messages and lines without a valid timestamp', () => {
    expect(parseUsageLine(assistantLine([text('x')], 0, { model: '<synthetic>' }))).toBeUndefined();
    expect(parseUsageLine(assistantLine([text('x')], 0).replace(/"timestamp":"[^"]+"/, '"timestamp":"never"'))).toBeUndefined();
  });

  test('never carries any text of the conversation', () => {
    const sample = parseUsageLine(assistantLine([text('SECRET-REPLY')], 0));
    expect(JSON.stringify(sample)).not.toContain('SECRET-REPLY');
  });
});
