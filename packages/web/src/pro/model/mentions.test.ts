import { describe, expect, it } from 'vitest';
import { activeToken, addPrompt, removePrompt, replaceToken, MAX_PROMPTS, promptNameOf } from './mentions';

describe('activeToken', () => {
  it('finds a mention being typed at the start of the text', () => {
    // Arrange
    const text = '@src';

    // Act
    const token = activeToken(text, text.length);

    // Assert
    expect(token).toEqual({ trigger: '@', query: 'src', start: 0, end: 4 });
  });

  it('finds a saved prompt being typed after a space', () => {
    // Arrange
    const text = 'please $rev';

    // Act
    const token = activeToken(text, text.length);

    // Assert
    expect(token).toEqual({ trigger: '$', query: 'rev', start: 7, end: 11 });
  });

  it('ignores an e-mail address and a price inside a word', () => {
    expect(activeToken('me@example.com', 14)).toBeNull();
    expect(activeToken('US$10', 5)).toBeNull();
  });

  it('stops looking at the first space before the cursor', () => {
    expect(activeToken('@src and more', 13)).toBeNull();
  });

  it('only looks behind the cursor', () => {
    // Arrange
    const text = '@src/app.ts rest';

    // Act
    const token = activeToken(text, 4);

    // Assert
    expect(token).toEqual({ trigger: '@', query: 'src', start: 0, end: 4 });
  });
});

describe('replaceToken', () => {
  it('puts the text in place of the token, keeps the rest and moves the cursor after it', () => {
    // Arrange
    const text = 'see @sr now';
    const token = { trigger: '@' as const, query: 'sr', start: 4, end: 7 };

    // Act
    const result = replaceToken(text, token, '@src/app.ts ');

    // Assert
    expect(result.text).toBe('see @src/app.ts  now');
    expect(result.caret).toBe(16);
  });
});

describe('saved prompts', () => {
  it('names a prompt after its first line, cut to a readable length', () => {
    expect(promptNameOf('Review this\nand more')).toBe('Review this');
    expect(promptNameOf('x'.repeat(100))).toHaveLength(48);
  });

  it('adds a prompt at the top without changing the list it got', () => {
    // Arrange
    const list = [{ id: 'a', name: 'A', text: 'a' }];

    // Act
    const next = addPrompt(list, 'b', 'New one');

    // Assert
    expect(next.map((prompt) => prompt.id)).toEqual(['b', 'a']);
    expect(next[0]?.text).toBe('New one');
    expect(list).toHaveLength(1);
  });

  it('does not store the same text twice', () => {
    // Arrange
    const list = [{ id: 'a', name: 'A', text: 'same' }];

    // Act
    const next = addPrompt(list, 'b', 'same');

    // Assert
    expect(next.map((prompt) => prompt.id)).toEqual(['a']);
  });

  it('drops the oldest when the list is full', () => {
    // Arrange
    const list = Array.from({ length: MAX_PROMPTS }, (_, index) => ({
      id: String(index),
      name: String(index),
      text: String(index),
    }));

    // Act
    const next = addPrompt(list, 'new', 'text');

    // Assert
    expect(next).toHaveLength(MAX_PROMPTS);
    expect(next[0]?.id).toBe('new');
    expect(next.at(-1)?.id).toBe(String(MAX_PROMPTS - 2));
  });

  it('removes a prompt by id', () => {
    // Arrange
    const list = [
      { id: 'a', name: 'A', text: 'a' },
      { id: 'b', name: 'B', text: 'b' },
    ];

    // Act
    const next = removePrompt(list, 'a');

    // Assert
    expect(next.map((prompt) => prompt.id)).toEqual(['b']);
  });
});
