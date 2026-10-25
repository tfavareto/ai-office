// The one-line highlight of the card and the caption that goes with it (pure): which message to say, with which
// numbers. The words come from the catalogs; project names are only used when the person turned them on.
import { type DayReport, projectTotals, reportTotals } from '@ai-office/shared';
import type { TextParams, UiKey } from '../i18n';

/** A catalog key of the app and its parameters, rendered with `t()` by whoever shows it. */
export interface UiMsg {
  key: UiKey;
  params?: TextParams;
}

const SCORE_TASK = 3;
const SCORE_COMMIT = 3;
const SCORE_TEST_RUN = 1;
const SCORE_FILE = 0.5;
/** A day with at least this many lines added gets the lines highlight. */
const MIN_LINES = 50;
const MIN_PARALLEL_ROOMS = 2;

function projectScore(totals: ReturnType<typeof projectTotals>): number {
  return (
    totals.tasks * SCORE_TASK +
    totals.commits * SCORE_COMMIT +
    (totals.testsPassed + totals.testsFailed) * SCORE_TEST_RUN +
    totals.files * SCORE_FILE
  );
}

export interface HighlightChoice {
  showProjectNames: boolean;
  /** Name of a project with no name of its own. */
  unknownProject: string;
}

/**
 * What to say about the day, most notable first: the busiest project (by name, only when names are on), tests that
 * all passed, lines written, rooms working in parallel, or a line about the office itself.
 */
export function pickHighlight(report: Pick<DayReport, 'projects'>, choice: HighlightChoice): UiMsg {
  const totals = reportTotals(report);
  const ranked = report.projects
    .map((project) => ({ project, totals: projectTotals(project) }))
    .filter((entry) => entry.totals.agents > 0)
    .sort((a, b) => projectScore(b.totals) - projectScore(a.totals));
  const top = ranked[0];
  if (choice.showProjectNames && top !== undefined && top.totals.tasks + top.totals.commits > 0)
    return {
      key: 'share.highlight.topProject',
      params: {
        project: top.project.name.length > 0 ? top.project.name : choice.unknownProject,
        tasks: top.totals.tasks,
        commits: top.totals.commits,
      },
    };
  if (totals.testsPassed > 0 && totals.testsFailed === 0)
    return { key: 'share.highlight.testsGreen', params: { n: totals.testsPassed } };
  if (totals.linesAdded >= MIN_LINES)
    return {
      key: 'share.highlight.lines',
      params: { added: totals.linesAdded, removed: totals.linesRemoved, files: totals.files },
    };
  if (ranked.length >= MIN_PARALLEL_ROOMS)
    return { key: 'share.highlight.parallel', params: { rooms: ranked.length, agents: totals.agents } };
  return { key: 'share.highlight.default' };
}

/** Whether the caption talks about today or about another day (then it names the date). */
export type CaptionWhen = 'today' | 'day';

/** The caption to paste next to the picture: what the team closed, in the user's own numbers, plus the repository. */
export function pickCaption(
  report: Pick<DayReport, 'projects'>,
  when: { when: CaptionWhen; date: string; url: string; /** Active time, formatted. */ time: string },
): UiMsg {
  const totals = reportTotals(report);
  const base = { today: when.when === 'today' ? 1 : 0, date: when.date, url: when.url };
  if (totals.tasks > 0 && totals.commits > 0)
    return { key: 'share.caption.tasksCommits', params: { ...base, tasks: totals.tasks, commits: totals.commits } };
  if (totals.tasks > 0) return { key: 'share.caption.tasks', params: { ...base, tasks: totals.tasks } };
  if (totals.commits > 0) return { key: 'share.caption.commits', params: { ...base, commits: totals.commits } };
  return { key: 'share.caption.time', params: { ...base, agents: totals.agents, time: when.time } };
}
