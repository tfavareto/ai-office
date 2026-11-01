import { describe, expect, it } from 'vitest';
import { foldText, nextInCycle, searchPalette, type PaletteItem } from './palette';

const item = (id: string, title: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  kind: 'agent',
  title,
  detail: '',
  words: '',
  waiting: false,
  ...extra,
});

describe('foldText', () => {
  it('ignores case and accents', () => {
    // Arrange
    const text = 'Café Ação';

    // Act
    const folded = foldText(text);

    // Assert
    expect(folded).toBe('cafe acao');
  });
});

describe('searchPalette', () => {
  it('lists agents waiting on you first when the query is empty', () => {
    // Arrange
    const items = [item('a', 'Ana'), item('b', 'Bruno', { waiting: true }), item('c', 'Caio')];

    // Act
    const found = searchPalette(items, '');

    // Assert
    expect(found.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('finds accented names without typing the accents', () => {
    // Arrange
    const items = [item('a', 'Otávio'), item('b', 'Bruno')];

    // Act
    const found = searchPalette(items, 'otav');

    // Assert
    expect(found.map((entry) => entry.id)).toEqual(['a']);
  });

  it('ranks a name that starts with the query above one that only contains its letters', () => {
    // Arrange
    const items = [item('far', 'Marina'), item('near', 'Ana')];

    // Act
    const found = searchPalette(items, 'an');

    // Assert
    expect(found[0]?.id).toBe('near');
  });

  it('ranks a match in the name above a match in the other words', () => {
    // Arrange
    const items = [item('words', 'Bruno', { words: 'api' }), item('name', 'api-gateway')];

    // Act
    const found = searchPalette(items, 'api');

    // Assert
    expect(found[0]?.id).toBe('name');
  });

  it('uses every word of the query to narrow the results', () => {
    // Arrange
    const items = [item('web', 'Claude', { detail: 'web' }), item('api', 'Claude', { detail: 'api' })];

    // Act
    const found = searchPalette(items, 'claude api');

    // Assert
    expect(found.map((entry) => entry.id)).toEqual(['api']);
  });

  it('accepts letters with gaps, and rejects letters out of order', () => {
    // Arrange
    const items = [item('a', 'market-intelligence')];

    // Act
    const inOrder = searchPalette(items, 'mktint');
    const outOfOrder = searchPalette(items, 'tkm');

    // Assert
    expect(inOrder).toHaveLength(1);
    expect(outOfOrder).toHaveLength(0);
  });

  it('does not match letters scattered across the second line', () => {
    // Arrange
    const items = [item('a', 'Carolina', { detail: 'Checkout HQ · code-reviewer · Lendo o arquivo base' })];

    // Act
    const found = searchPalette(items, 'nova');

    // Assert
    expect(found).toHaveLength(0);
  });

  it('never returns more than the limit', () => {
    // Arrange
    const items = Array.from({ length: 50 }, (_, index) => item(String(index), `Agent ${index}`));

    // Act
    const found = searchPalette(items, 'agent', 10);

    // Assert
    expect(found).toHaveLength(10);
  });
});

describe('nextInCycle', () => {
  it('starts at the first id when the current one is not in the list', () => {
    expect(nextInCycle(['a', 'b'], 'x')).toBe('a');
    expect(nextInCycle(['a', 'b'], null)).toBe('a');
  });

  it('moves to the next id and wraps around', () => {
    expect(nextInCycle(['a', 'b'], 'a')).toBe('b');
    expect(nextInCycle(['a', 'b'], 'b')).toBe('a');
  });

  it('returns null with nothing to cycle through', () => {
    expect(nextInCycle([], 'a')).toBeNull();
  });
});
