import { describe, expect, test } from 'vitest';
import { DEFAULT_OPEN_GROUPS, SETTINGS_GROUP_IDS, parseOpenGroups, toggleGroup } from './settings-groups';

describe('parseOpenGroups', () => {
  test('gives the default when nothing valid was stored', () => {
    expect(parseOpenGroups(undefined)).toEqual(DEFAULT_OPEN_GROUPS);
    expect(parseOpenGroups('office')).toEqual(DEFAULT_OPEN_GROUPS);
    expect(parseOpenGroups({ office: true })).toEqual(DEFAULT_OPEN_GROUPS);
  });

  test('keeps an empty list so a person can close every group', () => {
    expect(parseOpenGroups([])).toEqual([]);
  });

  test('drops unknown ids and repeats and follows the order of the groups', () => {
    expect(parseOpenGroups(['sound', 42, 'nope', 'general', 'sound'])).toEqual(['general', 'sound']);
  });

  test('starts with the first group open', () => {
    expect(DEFAULT_OPEN_GROUPS).toEqual([SETTINGS_GROUP_IDS[0]]);
  });
});

describe('toggleGroup', () => {
  test('opens a closed group', () => {
    expect(toggleGroup(['general'], 'data')).toEqual(['general', 'data']);
  });

  test('closes an open group', () => {
    expect(toggleGroup(['general', 'data'], 'general')).toEqual(['data']);
  });

  test('keeps the order of the groups whatever the order of opening', () => {
    expect(toggleGroup(['about'], 'office')).toEqual(['office', 'about']);
  });

  test('does not change the list it was given', () => {
    const open = ['general'] as const;
    toggleGroup(open, 'team');
    expect(open).toEqual(['general']);
  });
});
