// What the tools of a demo agent "printed": the demo has no transcript file, so its terminals show plausible results
// (a count of lines read, files found, lines changed, a test summary). Deterministic per activity, so a terminal shows
// the same output every time it is drawn.
import { fnv1a, type Activity } from '@ai-office/shared';
import { t } from '../../i18n';
import { activityDetail } from '../../ui/display';

function between(seed: number, min: number, max: number): number {
  return min + (Math.abs(seed) % (max - min + 1));
}

export function demoResult(activity: Activity): string {
  const seed = fnv1a(activity.id);
  const detail = activityDetail(activity) ?? '';
  switch (activity.kind) {
    case 'read':
      // The CLI prints a count for a file it read; the formatter counts these lines.
      return Array.from({ length: between(seed, 24, 320) }, () => '·').join('\n');
    case 'search':
      return t('pro.demo.found', { n: between(seed, 1, 14) });
    case 'edit':
      return t('pro.demo.edit', { added: between(seed, 1, 40), removed: between(seed >>> 3, 0, 18) });
    case 'write':
      return t('pro.demo.write', { n: between(seed, 12, 180) });
    case 'web':
      return t('pro.demo.fetch', { kb: between(seed, 4, 260) });
    case 'bash':
      if (/\btest\b|vitest|jest/.test(detail))
        return t('pro.demo.tests', { n: between(seed, 24, 420), seconds: between(seed >>> 4, 1, 19) });
      if (/\bbuild\b|tsc/.test(detail)) return t('pro.demo.build', { seconds: between(seed, 1, 14) });
      return t('pro.demo.ok');
    default:
      return '';
  }
}
