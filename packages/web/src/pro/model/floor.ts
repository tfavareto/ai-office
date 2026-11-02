// What each refusal about a floor means to the person.
import type { TextKey } from '../../i18n';

const ERROR_KEYS: Readonly<Record<string, TextKey>> = {
  'invalid-name': 'pro.floor.error.invalid-name',
  'not-a-repository': 'pro.floor.error.not-a-repository',
  'floor-exists': 'pro.floor.error.floor-exists',
  'not-a-floor': 'pro.floor.error.not-a-floor',
  'floor-dirty': 'pro.floor.error.floor-dirty',
  'floor-detached': 'pro.floor.error.floor-detached',
  'floor-has-ignored': 'pro.floor.error.floor-has-ignored',
  'unsafe-config': 'pro.floor.error.unsafe-config',
  'target-busy': 'pro.floor.error.target-busy',
  'target-dirty': 'pro.floor.error.target-dirty',
  'nothing-to-land': 'pro.floor.error.nothing-to-land',
  'floor-conflict': 'pro.floor.error.floor-conflict',
  'floor-busy': 'pro.floor.error.floor-busy',
  'git-failed': 'pro.floor.error.git-failed',
  demo: 'pro.floor.error.demo',
};

export function floorErrorKey(code: string): TextKey | undefined {
  return ERROR_KEYS[code];
}
