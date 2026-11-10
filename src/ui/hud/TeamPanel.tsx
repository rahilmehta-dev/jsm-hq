import { selectTeam, useOffice, type AgentView } from "../../store/office";
import { ui, useUi } from "../../store/ui";
import { stateStyle } from "../../theme/tokens";
import { ago, Portrait, StateChip, TitleBar, useNow } from "../kit";

function AgentRow({ a, focused, n, now }: { a: AgentView; focused: boolean; n: number; now: number }) {
  const snap = useOffice((s) => s.snap);
  const task = a.status.currentTaskId ? snap?.tasks.find((t) => t.id === a.status.currentTaskId) : null;
  const st = stateStyle[a.status.state];
  const needs = a.status.state === "needs-input";
  const blocked = useOffice((s) => s.snap?.sbx.agents[a.config.id]?.approvals?.length ?? 0);
  const items = useOffice((s) => (s.snap?.actionItems ?? []).filter((i) => i.status === "open" && i.fromId === a.config.id).length);
  // Selected row is inverted (selection colour, white text). Needs-input gets a tinted row plus a bold chip, so it never relies on colour alone.
  const tone = focused ? "bg-select text-select-ink" : needs ? "bg-bad-fill" : "bg-paper hover:bg-cream-2";
  const sub = focused ? "text-select-ink" : "text-ink-2";
  return (
    <button
      className={`grid w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-b border-ink px-2.5 py-2 text-left last:border-b-0 ${tone}`}
      onClick={() => ui.openAgent(a.config.id)}
      aria-label={`${a.config.name}, ${a.config.role}, ${st.label}`}
      aria-current={focused || undefined}
    >
      <div className="row-span-2">
        <Portrait color={a.config.color} lead={a.config.isLead} size={36} />
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <b className="text-[14px]">{a.config.name}</b>
        <span className={`truncate text-[12px] ${sub}`}>{a.config.role}</span>
        <span className="kbd ml-auto px-1 text-[12px] leading-none !text-ink">{n}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StateChip state={a.status.state} />
        <span className={`text-[12px] ${sub}`}>{ago(a.status.stateSince, now)}</span>
        {items > 0 && (
          <span className="chip bg-warn-fill text-[12px]" title="Action items from this agent. Open Action items in the top bar.">
            {items} for you
          </span>
        )}
        {blocked > 0 && (
          <span className="chip bg-warn-fill text-[12px]" title="Requests the sandbox blocked. Open the agent to allow or dismiss them.">
            {blocked} blocked
          </span>
        )}
      </div>
      <div className={`col-span-2 truncate text-[13px] leading-snug ${task || needs ? "" : sub}`}>
        {needs ? (
          <span className={focused ? "" : "font-semibold"}>{a.status.note}</span>
        ) : task ? (
          <>
            <span className={`mr-1 text-[12px] ${sub}`}>{task.id}</span>
            {task.title}
          </>
        ) : (
          a.status.note ?? "No task"
        )}
      </div>
    </button>
  );
}

export function TeamPanel() {
  const snap = useOffice((s) => s.snap);
  const drawer = useUi((s) => s.drawer);
  const now = useNow(1000);
  const team = selectTeam(snap);
  const needs = team.filter((a) => a.status.state === "needs-input").length;

  return (
    <section aria-label="Team" className="panel fixed bottom-[250px] left-4 top-[44px] z-10 flex w-[280px] flex-col">
      <TitleBar title={`Team · ${team.length}`} />
      <div className="flex items-center justify-between border-b border-ink bg-platinum px-2.5 py-1 text-[12px]">
        <span className="font-semibold">{needs > 0 ? `${needs} need you` : "All clear"}</span>
        <button className="btn !px-2 !py-0 text-[12px]" onClick={() => ui.openSettings("team")}>
          + Agent
        </button>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        {team.map((a, i) => (
          <AgentRow key={a.config.id} a={a} n={i + 1} now={now} focused={drawer?.kind === "agent" && drawer.id === a.config.id} />
        ))}
      </div>
    </section>
  );
}
