// "Conquistas": the office level and what it unlocks, the employee of the month, the badges and the lifetime numbers.
import {
  levelFraction,
  nextDecor,
  type AchievementState,
  type EmployeeOfTheMonth,
  type Progress,
  type ProgressStats,
} from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { h, toggleClass } from '../dom';
import { formatDateKey, formatDateLong, formatDuration, formatInteger, formatTokens } from '../format';
import { icon } from '../icons';
import {
  achievementHowKey,
  achievementNameKey,
  decorNameKey,
  decorRows,
  earnedCount,
  levelTitleKey,
  sortAchievements,
} from '../model/progress-view';
import { button, sectionTitle } from '../widgets';
import { Dialog, closeButton } from './overlay';

const TIER_KEY = {
  bronze: 'progress.tier.bronze',
  silver: 'progress.tier.silver',
  gold: 'progress.tier.gold',
} as const;

function levelCard(progress: Progress): HTMLElement {
  const { level } = progress;
  const fraction = Math.round(levelFraction(level) * 100);
  const next = nextDecor(level.level);
  return h(
    'section',
    { class: 'ao-prog-level' },
    h(
      'div',
      { class: `ao-prog-badge ${level.level >= 10 ? 'is-gold' : ''}`.trim(), 'aria-hidden': 'true' },
      String(level.level),
    ),
    h(
      'div',
      { class: 'ao-prog-level-main' },
      h('h3', null, t('progress.level', { level: level.level }), ' · ', t(levelTitleKey(level.level))),
      h(
        'div',
        {
          class: 'ao-prog-bar',
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(fraction),
          'aria-label': t('progress.xp', { xp: formatInteger(level.xp) }),
        },
        h('span', { style: `width:${fraction}%` }),
      ),
      h(
        'p',
        { class: 'ao-prog-xp' },
        t('progress.xp', { xp: formatInteger(level.xp) }),
        level.to === null
          ? ` · ${t('progress.xp.max')}`
          : ` · ${t('progress.xp.next', { missing: formatInteger(level.to - level.xp), level: level.level + 1 })}`,
      ),
      h(
        'p',
        { class: 'ao-prog-next' },
        icon('trophy', 14),
        next === undefined
          ? t('progress.next.none')
          : t('progress.next', { level: next.level, thing: t(decorNameKey(next.id)) }),
      ),
    ),
  );
}

function decorSection(level: number): HTMLElement {
  return h(
    'section',
    { class: 'ao-prog-section' },
    sectionTitle(t('progress.decor.title')),
    h(
      'ul',
      { class: 'ao-prog-decor' },
      ...decorRows(level).map((row) =>
        h(
          'li',
          { class: `ao-prog-chip ${row.unlocked ? 'is-on' : ''}`.trim() },
          h('span', { class: 'ao-prog-chip-name' }, t(decorNameKey(row.id))),
          h(
            'span',
            { class: 'ao-prog-chip-level' },
            row.unlocked ? t('progress.decor.unlocked') : t('progress.decor.locked', { level: row.level }),
          ),
        ),
      ),
    ),
  );
}

function employeeSection(employee: EmployeeOfTheMonth | undefined, showProject: boolean): HTMLElement {
  const body =
    employee === undefined
      ? h('p', { class: 'ao-note' }, t('progress.employee.none'))
      : h(
          'div',
          { class: 'ao-prog-employee' },
          h('strong', null, employee.name),
          h(
            'span',
            null,
            t('progress.employee.tasks', { n: employee.tasks }),
            showProject && employee.project !== undefined && employee.project !== ''
              ? ` · ${t('progress.employee.project', { project: employee.project })}`
              : '',
          ),
        );
  return h('section', { class: 'ao-prog-section' }, sectionTitle(t('progress.employee.title')), body);
}

function badge(item: AchievementState): HTMLElement {
  const earned = item.unlockedAt !== undefined;
  const fraction = Math.round((item.target === 0 ? 0 : item.value / item.target) * 100);
  const tier = t(TIER_KEY[item.tier]);
  return h(
    'li',
    {
      class: `ao-prog-badgecard is-${item.tier} ${earned ? 'is-earned' : 'is-locked'}`,
      'aria-label': `${t(achievementNameKey(item.id))}, ${tier}, ${earned ? t('progress.badge.unlocked', { date: formatDateLong(item.unlockedAt as number) }) : t('progress.badge.locked')}`,
    },
    h('span', { class: 'ao-prog-medal', 'aria-hidden': 'true' }, icon('trophy', 20)),
    h(
      'div',
      { class: 'ao-prog-badgetext' },
      h('strong', null, t(achievementNameKey(item.id))),
      h('span', { class: 'ao-prog-how' }, t(achievementHowKey(item.id))),
      earned
        ? h(
            'span',
            { class: 'ao-prog-date' },
            t('progress.badge.unlocked', { date: formatDateLong(item.unlockedAt as number) }),
          )
        : h(
            'div',
            { class: 'ao-prog-mini' },
            h(
              'div',
              { class: 'ao-prog-bar ao-prog-bar--small', 'aria-hidden': 'true' },
              h('span', { style: `width:${fraction}%` }),
            ),
            h(
              'span',
              null,
              t('progress.badge.progress', { value: formatInteger(item.value), target: formatInteger(item.target) }),
            ),
          ),
    ),
  );
}

function badgesSection(list: readonly AchievementState[]): HTMLElement {
  return h(
    'section',
    { class: 'ao-prog-section' },
    sectionTitle(t('progress.badges.title', { done: earnedCount(list), total: list.length })),
    h('ul', { class: 'ao-prog-badges' }, ...sortAchievements(list).map(badge)),
  );
}

function statsSection(stats: ProgressStats): HTMLElement {
  const cells: [string, string][] = [
    [t('progress.stats.sessions'), formatInteger(stats.sessions)],
    [t('progress.stats.activeTime'), formatDuration(stats.activeMs)],
    [t('progress.stats.tasks'), formatInteger(stats.tasks)],
    [t('progress.stats.commits'), formatInteger(stats.commits)],
    [t('progress.stats.tests'), formatInteger(stats.testsPassed)],
    [t('progress.stats.tokens'), formatTokens(stats.tokens)],
    [t('progress.stats.days'), formatInteger(stats.daysActive)],
    [t('progress.stats.streak'), t('progress.stats.days.value', { n: stats.currentStreak })],
    [t('progress.stats.bestStreak'), t('progress.stats.days.value', { n: stats.bestStreak })],
    [t('progress.stats.peak'), formatInteger(stats.peakAgents)],
  ];
  return h(
    'section',
    { class: 'ao-prog-section' },
    sectionTitle(t('progress.stats.title')),
    h(
      'dl',
      { class: 'ao-prog-stats' },
      ...cells.map(([label, value]) => h('div', null, h('dt', null, label), h('dd', null, value))),
    ),
  );
}

export class AchievementsDialog extends Dialog {
  private readonly body = h('div', { class: 'ao-prog-body' });
  private readonly retry = button({
    label: t('common.retry'),
    variant: 'soft',
    className: 'ao-btn--small',
    onClick: () => this.load(),
  });
  private shown = '';
  private loadedFor = '';

  constructor(ctx: AppContext) {
    super(ctx, 'achievements', 'ao-prog-title', 'ao-dialog--progress');
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h('h2', { id: 'ao-prog-title' }, t('progress.title')),
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      this.body,
    );
  }

  protected onOpen(): void {
    this.shown = '';
    this.load();
  }

  private load(): void {
    this.loadedFor = this.signature();
    void this.ctx.progress.load(this.ctx.prefs.get().employeeProject);
  }

  /** What the server's progress would look like now: when this changes while the dialog is open, it is read again. */
  private signature(): string {
    const summary = this.ctx.liveSnapshot?.progress;
    return `${summary?.level ?? 0}|${summary?.achievements ?? 0}|${summary?.employee ?? ''}|${this.ctx.prefs.get().employeeProject}`;
  }

  protected update(): void {
    if (this.signature() !== this.loadedFor) this.load();
    const state = this.ctx.progress.get();
    const prefs = this.ctx.prefs.get();
    const key = `${state.status}|${state.progress === null ? '' : JSON.stringify(state.progress)}|${state.error ?? ''}|${prefs.evolution}|${prefs.employeeProject}|${t('progress.title')}`;
    if (key === this.shown) return;
    this.shown = key;
    this.body.replaceChildren(
      ...this.content(state.status, state.progress, state.error, prefs.evolution, prefs.employeeProject),
    );
  }

  private content(
    status: string,
    progress: Progress | null,
    error: string | null,
    evolution: boolean,
    showProject: boolean,
  ): Node[] {
    if (progress === null) {
      return status === 'error'
        ? [
            h(
              'div',
              { class: 'ao-prog-status' },
              h('p', { class: 'ao-note' }, error ?? t('progress.error')),
              this.retry,
            ),
          ]
        : [h('p', { class: 'ao-note ao-prog-status' }, t('progress.loading'))];
    }
    const notes = [
      progress.demo === true ? t('progress.demo') : null,
      progress.counting === true ? t('progress.counting') : null,
      !evolution ? t('progress.off') : null,
      status === 'error' ? (error ?? t('progress.error')) : null,
    ].filter((text): text is string => text !== null);
    const sections: Node[] = [
      levelCard(progress),
      ...notes.map((text) => h('p', { class: 'ao-note ao-prog-note' }, text)),
      employeeSection(progress.employee, showProject),
      decorSection(progress.level.level),
      badgesSection(progress.achievements),
      statsSection(progress.stats),
    ];
    if (progress.since !== undefined && progress.demo !== true)
      sections.push(
        h('p', { class: 'ao-note ao-prog-note' }, t('progress.since', { date: formatDateKey(progress.since) })),
      );
    toggleClass(this.panel, 'is-gold', progress.level.level >= 10);
    return sections;
  }
}
