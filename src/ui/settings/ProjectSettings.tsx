import { useState } from "react";
import { DEFAULT_OFFICE_NAME, OFFICE_NAME_MAX } from "../../data/names";
import { FONT_STYLES, savedFont, setFont, type FontStyle } from "../../theme/fonts";
import { BUDGET_PROVIDERS, USAGE_PROVIDER_LABEL, type BudgetProvider } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { Field, SectionTitle } from "../kit";
import { CommitInput, Toggle } from "./controls";

function FontPicker() {
  const [font, setCurrent] = useState(savedFont);
  return (
    <section className="border border-ink bg-white p-3">
      <SectionTitle>Font</SectionTitle>
      <Field label="Font style" hint="For panels, drawers, settings and agent terminals. The office stays pixel. Saved in this browser only.">
        <select
          className="field w-[320px]"
          value={font}
          onChange={(e) => {
            const f = e.target.value as FontStyle;
            setFont(f);
            setCurrent(f);
          }}
        >
          {FONT_STYLES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} · {f.hint}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** The user's own daily token budget per cloud provider. Without one, HQ shows tokens but no percentage. */
function UsageBudgets() {
  const budgets = useOffice((s) => s.snap?.config.project.dailyTokenBudgets);
  const providers = useOffice((s) => s.snap?.usage?.providers);
  const local = providers?.find((p) => p.provider === "local");
  const commit = (p: BudgetProvider, v: string) => {
    const n = Number(v.replace(/[,_\s]/g, ""));
    // Empty clears the budget (sent as 0); anything that isn't a whole, positive number is ignored.
    if (!v.trim()) officeActions.updateProject({ dailyTokenBudgets: { [p]: 0 } });
    else if (Number.isFinite(n) && n > 0) officeActions.updateProject({ dailyTokenBudgets: { [p]: Math.round(n) } });
  };
  return (
    <section className="grid grid-cols-2 gap-3 border border-ink bg-white p-3">
      <div className="col-span-2">
        <SectionTitle>Daily token budgets</SectionTitle>
        <p className="m-0 text-[13px] text-ink-2">
          HQ counts the tokens agents use each day (local midnight to midnight) from their own session files on this machine, and never sends them anywhere. Providers don&apos;t publish a daily token limit, so set your own to see how much is left. Without a budget, HQ shows tokens only, no percentage. Input, output and cache writes count; cache reads are shown separately.
        </p>
      </div>
      {BUDGET_PROVIDERS.map((p) => {
        const used = providers?.find((r) => r.provider === p);
        return (
          <Field
            key={p}
            label={USAGE_PROVIDER_LABEL[p]}
            hint={used ? `Used today: ${fmt(used.tokens)} tokens${used.unmeasured ? ` (${used.unmeasured} agent${used.unmeasured === 1 ? "" : "s"} not measurable)` : ""}${used.remainingPercent !== null ? ` · ${used.remainingPercent}% left` : ""}` : "No agents on this provider."}
          >
            <CommitInput
              className="field font-term text-[17px]"
              value={budgets?.[p] ? fmt(budgets[p]) : ""}
              placeholder="No budget"
              onCommit={(v) => commit(p, v)}
            />
          </Field>
        );
      })}
      <Field label={USAGE_PROVIDER_LABEL.local} hint="Ollama and local servers have no limit: HQ shows their tokens without a battery.">
        <span className="field font-term text-[17px] text-muted">{local ? `${fmt(local.tokens)} tokens today` : "Unlimited"}</span>
      </Field>
    </section>
  );
}

export function ProjectSettings() {
  const project = useOffice((s) => s.snap?.config.project);
  if (!project) return null;
  return (
    <div className="flex flex-col gap-5">
      <FontPicker />
      <section className="grid grid-cols-2 gap-3 border border-ink bg-white p-3">
        <div className="col-span-2">
          <SectionTitle>Project</SectionTitle>
        </div>
        <Field label="Name">
          <CommitInput className="field" value={project.name} onCommit={(v) => v.trim() && officeActions.updateProject({ name: v.trim() })} />
        </Field>
        <Field label="Office name" hint={`The sign on the office wall. Up to ${OFFICE_NAME_MAX} characters; letters and numbers read best.`}>
          <CommitInput
            className="field"
            maxLength={OFFICE_NAME_MAX}
            value={project.officeName ?? ""}
            placeholder={DEFAULT_OFFICE_NAME}
            onCommit={(v) => officeActions.updateProject({ officeName: v.trim() })}
          />
        </Field>
        <Field label="GitHub repo" hint="owner/name. HQ only reads PRs, checks and comments.">
          <CommitInput className="field font-term text-[17px]" value={project.repo} onCommit={(v) => v.trim() && officeActions.updateProject({ repo: v.trim() })} />
        </Field>
        <Field label="Local path">
          <CommitInput className="field font-term text-[17px]" value={project.path} onCommit={(v) => v.trim() && officeActions.updateProject({ path: v.trim() })} />
        </Field>
        <Field label="HQ port" hint="Sandboxes reach HQ at host.docker.internal on this port.">
          <CommitInput
            className="field font-term text-[17px]"
            value={String(project.hqPort)}
            onCommit={(v) => {
              const n = Number(v);
              if (Number.isInteger(n) && n > 1023 && n < 65536) officeActions.updateProject({ hqPort: n });
            }}
          />
        </Field>
      </section>
      <UsageBudgets />
      <section>
        <SectionTitle>Plan</SectionTitle>
        <Toggle checked={!!project.exportPlan} onChange={(v) => officeActions.updateProject({ exportPlan: v })} label="Export plan to docs/plan.md" />
        <p className="mt-1 text-[13px] text-ink-2">
          HQ keeps the plan in .jsmhq/plan.json. With this on, it also writes a readable copy to docs/plan.md every time the plan changes, so you can commit it or read it on GitHub. Edits to that file are overwritten.
        </p>
      </section>
      <section className="text-[13px] text-ink-2">
        <SectionTitle>Security</SectionTitle>
        <ul className="list-disc pl-5">
          <li>HQ binds 127.0.0.1 only.</li>
          <li>A random token is created on every start. The browser, hooks and the Team MCP must send it.</li>
          <li>HQ never reads .env files. Sandboxes get keys from Docker's secret store.</li>
        </ul>
      </section>
    </div>
  );
}
