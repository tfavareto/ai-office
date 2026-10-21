// The Git section of a room's drawer: branch (with copy), changes, ahead/behind, last commit and, when the person turned
// pull requests on and `gh` found one, the pull request with its CI badge and checks.
import type { GitPullRequest, Project, ProjectGit } from '@ai-office/shared';
import { t, type UiKey } from '../../i18n';
import type { AppContext, Component } from '../context';
import { compact, h } from '../dom';
import { formatAgo } from '../format';
import { icon } from '../icons';
import {
  CI_TONE,
  REVIEW_TONE,
  branchChip,
  changeCounts,
  checksView,
  lineChanges,
  prBadgeState,
  syncState,
  type PrTone,
} from '../model/git';
import { emptyNote, sectionTitle } from '../widgets';

const MINUTE_MS = 60_000;

function badge(tone: PrTone, label: string, className = ''): HTMLElement {
  return h(
    'span',
    { class: `ao-git-badge ao-git-badge--${tone} ${className}`.trim() },
    h('span', { class: 'ao-git-badge-dot', 'aria-hidden': 'true' }),
    label,
  );
}

function linesLabel(lines: { insertions: number; deletions: number }): string {
  return t('git.lines', { added: lines.insertions, removed: lines.deletions });
}

export class GitSection implements Component {
  readonly el = h('div', { class: 'ao-block ao-git', hidden: true });
  private signature = '';

  constructor(private readonly ctx: AppContext) {}

  /** Shows the repository of `project`, or hides the section when there is nothing to show. */
  update(project: Project | undefined): void {
    const git = project?.git;
    const shown = git !== undefined && this.ctx.prefs.get().showGit;
    this.el.hidden = !shown;
    if (!shown || git === undefined) {
      this.signature = '';
      return;
    }
    const meta = this.ctx.snapshot?.meta;
    const hint = git.pr === undefined && meta?.gitPullRequests !== true && meta?.demo !== true && this.ctx.isLocal;
    const signature = `${JSON.stringify(git)}|${hint}|${Math.floor(this.ctx.now() / MINUTE_MS)}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.el.replaceChildren(
      ...compact(
        sectionTitle(t('git.title')),
        this.branchRow(git),
        this.changesRow(git),
        this.syncRow(git),
        this.commitRow(git),
        git.stash > 0 ? h('p', { class: 'ao-git-line ao-git-muted' }, t('git.stash', { n: git.stash })) : null,
        git.pr !== undefined ? this.pullRequest(git.pr) : hint ? emptyNote(t('git.pr.off'), 'ao-git-hint') : null,
      ),
    );
  }

  render(): void {
    // The drawer calls `update` with the room; nothing to do on its own.
  }

  // --- rows ---------------------------------------------------------------------------------------------------------

  private branchRow(git: ProjectGit): HTMLElement {
    const chip = branchChip(git);
    const name = chip?.label ?? '';
    const copy = h(
      'button',
      {
        type: 'button',
        class: 'ao-iconbtn ao-iconbtn--small',
        'aria-label': t('git.branch.copy'),
        title: t('git.branch.copy'),
        onclick: () => this.ctx.copy(name, t('git.branch.copied')),
      },
      icon('copy', 14),
    );
    return h(
      'div',
      { class: 'ao-git-branchrow' },
      h('span', { class: 'ao-git-branch-icon', 'aria-hidden': 'true' }, icon('branch', 16)),
      h('code', { class: 'ao-git-branch', title: name }, name),
      chip?.detached ? h('span', { class: 'ao-git-badge ao-git-badge--muted' }, t('git.detached')) : null,
      git.op !== undefined ? badge('bad', t(`git.operation.${git.op}` satisfies UiKey)) : null,
      copy,
    );
  }

  private changesRow(git: ProjectGit): HTMLElement {
    const counts = changeCounts(git);
    if (counts.length === 0) return h('p', { class: 'ao-git-line ao-git-muted' }, t('git.clean'));
    const lines = lineChanges(git);
    return h(
      'div',
      { class: 'ao-git-changes' },
      ...counts.map((count) =>
        h(
          'span',
          { class: `ao-git-change ao-git-change--${count.kind}` },
          t(`git.changes.${count.kind}` satisfies UiKey, { n: count.n }),
        ),
      ),
      lines
        ? h(
            'span',
            { class: 'ao-git-lines', title: linesLabel(lines), 'aria-label': linesLabel(lines) },
            h('span', { class: 'ao-git-add' }, `+${lines.insertions}`),
            ' ',
            h('span', { class: 'ao-git-del' }, `−${lines.deletions}`),
          )
        : null,
    );
  }

  private syncRow(git: ProjectGit): HTMLElement {
    const sync = syncState(git);
    if (sync.kind === 'no-upstream') return h('p', { class: 'ao-git-line ao-git-muted' }, t('git.sync.none'));
    if (sync.kind === 'in-sync')
      return h(
        'p',
        { class: 'ao-git-line' },
        h('span', { class: 'ao-git-arrows', 'aria-hidden': 'true' }, icon('check', 14)),
        t('git.sync.inSync', { upstream: sync.upstream }),
      );
    const arrow = (kind: 'ahead' | 'behind', n: number): HTMLElement | null =>
      n === 0
        ? null
        : h(
            'span',
            {
              class: `ao-git-arrow ao-git-arrow--${kind}`,
              title: t(`git.sync.${kind}`, { n }),
              'aria-label': t(`git.sync.${kind}`, { n }),
            },
            icon(kind === 'ahead' ? 'arrowUp' : 'arrowDown', 14),
            String(n),
          );
    return h(
      'p',
      { class: 'ao-git-line ao-git-sync' },
      arrow('ahead', sync.ahead),
      arrow('behind', sync.behind),
      h('span', { class: 'ao-git-muted' }, t('git.sync.upstream', { upstream: sync.upstream })),
    );
  }

  private commitRow(git: ProjectGit): HTMLElement | null {
    const commit = git.lastCommit;
    if (commit === undefined) return null;
    return h(
      'div',
      { class: 'ao-git-commit' },
      h('span', { class: 'ao-git-commit-title' }, t('git.lastCommit')),
      h(
        'div',
        { class: 'ao-git-commit-body' },
        h('code', { class: 'ao-git-hash' }, commit.hash),
        h('span', { class: 'ao-git-subject', title: commit.subject }, commit.subject),
        h('span', { class: 'ao-git-muted ao-git-ago' }, formatAgo(Math.max(0, this.ctx.now() - commit.at))),
      ),
    );
  }

  private pullRequest(pr: GitPullRequest): HTMLElement {
    const state = prBadgeState(pr);
    const tone: PrTone = state === 'merged' ? 'ok' : state === 'closed' ? 'bad' : state === 'draft' ? 'muted' : 'warn';
    const view = checksView(pr.checks);
    const open = pr.state === 'open';
    const lines: HTMLElement[] = [];
    if (view.total > 0)
      lines.push(h('p', { class: 'ao-git-line' }, t('git.checks.passed', { passed: view.passed, total: view.total })));
    if (view.failing.length > 0) {
      lines.push(
        h('p', { class: 'ao-git-line ao-git-failing' }, t('git.checks.failing', { names: view.failing.join(', ') })),
      );
      if (view.moreFailing > 0)
        lines.push(h('p', { class: 'ao-git-line ao-git-failing' }, t('git.checks.more', { n: view.moreFailing })));
    }
    if (view.pending > 0)
      lines.push(h('p', { class: 'ao-git-line ao-git-muted' }, t('git.checks.pending', { n: view.pending })));
    return h(
      'div',
      { class: 'ao-git-pr' },
      h('div', { class: 'ao-git-pr-title' }, t('git.pr.title')),
      h(
        'a',
        {
          class: 'ao-git-pr-link',
          href: pr.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: t('git.pr.open', { number: pr.number }),
          'aria-label': `${t('git.pr.open', { number: pr.number })}: ${pr.title}`,
        },
        h('span', { class: 'ao-git-pr-number' }, `#${pr.number}`),
        h('span', { class: 'ao-git-pr-name' }, pr.title),
        icon('link', 14),
      ),
      h(
        'div',
        { class: 'ao-git-badges' },
        badge(tone, t(`git.pr.state.${state}` satisfies UiKey)),
        pr.review !== undefined && open
          ? badge(REVIEW_TONE[pr.review], t(`git.pr.review.${pr.review}` satisfies UiKey))
          : null,
        open && pr.ci !== 'none' ? badge(CI_TONE[pr.ci], t(`git.ci.${pr.ci}` satisfies UiKey), 'ao-git-ci') : null,
      ),
      ...(open ? lines : []),
    );
  }
}
