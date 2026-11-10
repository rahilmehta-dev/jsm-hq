// Polls GitHub, keeps the office's PRs in sync, and runs the review automations:
// comments → tell the author; passed → tell the lead; merged → task done.

import { prKey, type PullRequest } from "../src/data/types";
import { branchAgent, fetchPrs, OPEN_LIMIT, prRef, RateLimited, repoFlag, taskIdOf, toPullRequest } from "./github";
import type { Hub } from "./hub";
import { log } from "./lib/log";
import type { Planner } from "./planner";
import { detectRepo } from "./repo";

const MERGE_CMD = (n: number | string, repoArg = "") => `gh pr merge ${n} --squash --delete-branch${repoArg}`;

/** What the lead is told when a PR passes review: merge it, or leave it to the user (Settings → Workflow → Merge). */
export function passedNotice(pr: Pick<PullRequest, "number" | "title" | "repo">, author: string, by: "human" | "lead", mainRepo: string | null = null): string {
  const head = `PR ${prRef(pr, mainRepo)} (${pr.title}) by ${author} passed review.`;
  return by === "lead"
    ? `${head} You merge PRs on this project: run \`${MERGE_CMD(pr.number, repoFlag(pr, mainRepo))}\` now. If GitHub refuses (conflicts or failing checks), ask the author to fix it instead. Then assign the next task if anything is waiting.`
    : `${head} It's ready for the user to merge. Don't merge it yourself.`;
}

/** What the lead is told when the user changes who merges, with the PRs already waiting (as `#N` or `owner/name#N`). */
export function mergeByNotice(by: "human" | "lead", waiting: string[]): string {
  if (by === "human") return "The user changed the workflow: the user merges PRs now. Don't merge PRs yourself.";
  const list = waiting.length ? ` These passed review and are waiting: ${waiting.join(", ")}. Merge each with \`${MERGE_CMD("<number>")}\`; for one written as owner/name#N, add \`--repo owner/name\`.` : "";
  return `The user changed the workflow: you now merge PRs once they pass review.${list}`;
}

const MIN_POLL_MS = 20_000; // never more often than this (nudges included)
const MAX_POLL_MS = 5 * 60_000;
const HQ_BUDGET = 1200; // GraphQL points per hour HQ may use; the rest of the 5,000 is left for the agents' gh commands
const LOW_REMAINING = 800; // below this, poll at most every 2 minutes
const WORKSPACE_REPO_TTL_MS = 5 * 60_000; // how long an agent folder's GitHub remote is remembered
const label = { coderabbit: "CodeRabbit", greptile: "Greptile", copilot: "Copilot", human: "The reviewer", custom: "The review check" } as const;

export class GitHubSync {
  private prev = new Map<string, PullRequest>(); // by prKey
  private baselined = new Set<string>(); // repos whose first poll is done (no reactions to what was already there)
  private timer: NodeJS.Timeout | null = null;
  private nudgeTimer: NodeJS.Timeout | null = null;
  private busy = false;
  private errors = new Map<string, string>(); // repo → last error shown
  private rateMsg: string | null = null;
  private lastFetch = 0;
  private interval = MIN_POLL_MS;
  private pausedUntil = 0;
  private workspaceRepos = new Map<string, { github: string | null; at: number }>(); // workspacePath → its GitHub repo

  constructor(private hub: Hub, private planner: Planner, private repo: string | null) {}

  start() {
    if (!this.repo) log.warn("The main repo has no GitHub remote: only agents' workspace repos (if any) are tracked.");
    void this.tick();
    // Check sooner when an agent finishes a turn (it may have run `gh pr create`)
    // or reports a PR with set_my_status in-review.
    let reviewCfg = JSON.stringify(this.hub.snap.config.workflow.review);
    this.hub.subscribe((e) => {
      // A review-settings change re-labels existing PRs; take a fresh baseline
      // instead of treating that as new review activity.
      if (e.type === "config.updated" && JSON.stringify(e.config.workflow.review) !== reviewCfg) {
        reviewCfg = JSON.stringify(e.config.workflow.review);
        this.baselined.clear();
        this.nudge(500);
      }
      if (e.type === "activity" && e.event.type === "agent.answered") this.nudge();
      if (e.type === "task.updated" && e.task.status === "in-review") this.nudge(1500);
    });
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
  }

  /** One poll, then schedule the next at the current interval. */
  private async tick() {
    await this.refresh();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), Math.max(this.interval, this.pausedUntil - Date.now()));
  }

  /** Refresh soon (debounced): an agent just opened a PR or finished a turn. Still respects the minimum gap and any pause. */
  nudge(delayMs = 3000) {
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    const wait = Math.max(delayMs, this.lastFetch + MIN_POLL_MS - Date.now(), this.pausedUntil - Date.now());
    this.nudgeTimer = setTimeout(() => void this.refresh(), wait);
  }

  /**
   * Poll often enough to stay within HQ's share of the budget, however many repos there are: the
   * cost of a whole cycle (all repos) sets the interval. Slow down when the budget runs low.
   */
  private pace(cycleCost: number, minRemaining: number) {
    const forBudget = Math.ceil((Math.max(1, cycleCost) * 3_600_000) / HQ_BUDGET);
    const low = minRemaining < LOW_REMAINING ? 120_000 : 0;
    this.interval = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, forBudget, low));
  }

  /** The repos to poll: the main repo, then the GitHub remote of each agent's own workspace folder (once each). */
  private async monitoredRepos(): Promise<string[]> {
    const repos = new Set<string>();
    if (this.repo) repos.add(this.repo);
    const now = Date.now();
    const paths = new Set(this.hub.snap.config.team.map((a) => a.workspacePath?.trim()).filter((p): p is string => !!p));
    for (const path of paths) {
      let hit = this.workspaceRepos.get(path);
      if (!hit || now - hit.at > WORKSPACE_REPO_TTL_MS) {
        const github = await detectRepo(path).then((r) => r.github).catch(() => null);
        hit = { github, at: now };
        this.workspaceRepos.set(path, hit);
      }
      if (hit.github) repos.add(hit.github);
    }
    for (const path of this.workspaceRepos.keys()) if (!paths.has(path)) this.workspaceRepos.delete(path);
    return [...repos];
  }

  async refresh() {
    if (this.busy || Date.now() < this.pausedUntil) return;
    // Never closer together than the minimum gap (a nudge can land right after a regular poll).
    if (Date.now() - this.lastFetch < MIN_POLL_MS - 1000) return;
    if (!this.hub.snap.setup.checks.find((c) => c.id === "gh" && c.status === "ok")) return;
    this.busy = true;
    this.lastFetch = Date.now();
    try {
      const repos = await this.monitoredRepos();
      if (!repos.length) return;
      const wf = this.hub.snap.config.workflow;
      const team = new Set(this.hub.snap.config.team.map((a) => a.id));
      const next: PullRequest[] = [];
      let cost = 0;
      let remaining = Infinity;
      let limited: RateLimited | null = null;

      // One repo at a time (gentler on GitHub's secondary limits). One repo failing never loses the others:
      // its last known PRs are kept as they were.
      for (const repo of repos) {
        const keep = () => next.push(...[...this.prev.values()].filter((p) => p.repo === repo));
        if (limited) {
          keep(); // the rate limit is account-wide; don't spend more calls on it
          continue;
        }
        try {
          const { open, merged, closed, rate } = await fetchPrs(repo);
          if (this.errors.delete(repo)) log.info(`GitHub reachable again for ${repo}`);
          if (rate) {
            cost += Math.max(1, rate.cost);
            remaining = Math.min(remaining, rate.remaining);
          } else cost += 1;
          const fresh = [...open, ...merged].map((gh) => {
            const taskId = taskIdOf(gh);
            const task = taskId ? this.planner.task(taskId) : undefined;
            const fromBranch = branchAgent(gh.headRefName);
            const authorId = task?.ownerId ?? (fromBranch && team.has(fromBranch) ? fromBranch : "");
            return toPullRequest(gh, repo, wf.review.tool, wf.review.enabled, task?.id ?? taskId ?? "", authorId);
          });
          // PRs we showed as open that are now neither open nor recently merged were closed. A full page of
          // open PRs may have left older ones out, so then only the recently-closed list proves it.
          const seen = new Set(fresh.map(prKey));
          const complete = open.length < OPEN_LIMIT;
          const recentlyClosed = new Set(closed.map((n) => prKey({ repo, number: n })));
          for (const old of this.prev.values())
            if (old.repo === repo && !seen.has(prKey(old)) && !old.merged && !old.closed) fresh.push(complete || recentlyClosed.has(prKey(old)) ? { ...old, closed: true } : old);
          const first = !this.baselined.has(repo);
          for (const pr of fresh) {
            const old = this.prev.get(prKey(pr));
            if (JSON.stringify(old) !== JSON.stringify(pr)) this.hub.emit({ type: "pr.updated", pr: { ...pr } });
            if (!first) this.react(old, pr);
            this.syncTask(pr);
          }
          this.baselined.add(repo);
          next.push(...fresh);
        } catch (err) {
          keep();
          if (err instanceof RateLimited) limited = err;
          else {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg !== this.errors.get(repo)) log.warn(`GitHub (${repo}): ${msg}`);
            this.errors.set(repo, msg);
          }
        }
      }

      this.hub.snap.pullRequests = next;
      this.prev = new Map(next.map((p) => [prKey(p), p]));
      if (cost > 0) this.pace(cost, remaining);
      if (limited) {
        this.pausedUntil = limited.resetAt.getTime() + 5000;
        const at = limited.resetAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const msg = `GitHub API rate limit reached (shared with your agents' gh commands). PR sync paused until ${at}.`;
        if (msg !== this.rateMsg) {
          log.warn(msg);
          this.hub.activity("config", null, msg);
        }
        this.rateMsg = msg;
      } else this.rateMsg = null;
    } finally {
      this.busy = false;
    }
  }

  /** Keep the task board in line with its PR. */
  private syncTask(pr: PullRequest) {
    const task = pr.taskId ? this.planner.task(pr.taskId) : undefined;
    if (!task || pr.closed) return;
    const link = { prNumber: pr.number, prRepo: pr.repo };
    if (pr.merged && task.status !== "done") this.planner.updateTask(task.id, { status: "done", ...link });
    else if (!pr.merged && (task.status === "todo" || task.status === "in-progress")) this.planner.updateTask(task.id, { status: "in-review", ...link });
    else if (!pr.merged && (task.prNumber !== pr.number || (pr.repo && task.prRepo !== pr.repo))) this.planner.updateTask(task.id, link);
  }

  private react(old: PullRequest | undefined, pr: PullRequest) {
    const hub = this.hub;
    const who = pr.authorId || null;
    const tool = label[hub.snap.config.workflow.review.tool];
    const lead = hub.snap.config.team.find((a) => a.isLead);
    const main = this.repo;
    const num = prRef(pr, main);
    const ref = `${num} ${pr.title}`;

    if (!old && !pr.merged && !pr.closed) hub.activity("pr.opened", who, `${hub.name(who)} opened PR ${ref}`);
    if (pr.closed && !old?.closed) return hub.activity("config", who, `PR ${num} was closed without merging`);

    if (pr.merged && !old?.merged) {
      hub.activity("pr.merged", null, `PR ${ref} was merged`);
      if (lead) this.planner.notify(lead.id, `PR ${num} (${pr.title}) was merged${pr.taskId ? `; ${pr.taskId} is done` : ""}. Assign the next task if anything is waiting.`);
      return;
    }
    if (pr.merged) return;

    if (pr.review === "reviewing" && old?.review !== "reviewing") hub.activity("review.started", null, `${tool} is reviewing ${num}`);

    const newComments = pr.review === "changes-requested" && (old?.review !== "changes-requested" || pr.openComments > (old?.openComments ?? 0));
    if (newComments) {
      const n = pr.openComments;
      hub.activity("review.changes", who, `${tool} left ${n || "new"} comment${n === 1 ? "" : "s"} on ${num}`);
      if (who)
        this.planner.notify(
          who,
          `${tool} reviewed your PR ${num} (${pr.title}) and left ${n || "new"} open comment${n === 1 ? "" : "s"}. ` +
            `Read them with \`gh pr view ${pr.number} --comments${repoFlag(pr, main)}\` (or the GitHub API), fix them on the same branch, push, and resolve each thread you fixed.`,
        );
    }

    if (pr.review === "passed" && old?.review !== "passed") {
      hub.activity("review.passed", who, `${tool} approved ${num}`);
      if (lead) this.planner.notify(lead.id, passedNotice(pr, hub.name(who), hub.snap.config.workflow.merge.by, main));
    }

    if (pr.conflict && !old?.conflict && who)
      this.planner.notify(who, `Your PR ${num} has merge conflicts with main. Pull main, rebase or merge it into your branch, fix the conflicts, and push.`);
  }
}
