import { motion, useReducedMotion } from "framer-motion";
import { TitleBar } from "../kit";
import { ui, useUi, type SettingsTab } from "../../store/ui";
import { BoardsSettings } from "./BoardsSettings";
import { ProjectSettings } from "./ProjectSettings";
import { SandboxSettingsTab } from "./SandboxSettings";
import { StackSettings } from "./StackSettings";
import { McpSettings } from "./McpSettings";
import { TeamSettings } from "./TeamSettings";
import { WorkflowSettings } from "./WorkflowSettings";

const TABS: { id: SettingsTab; label: string; hint: string }[] = [
  { id: "team", label: "Team", hint: "Agents, roles, skills" },
  { id: "workflow", label: "Workflow", hint: "Review, merge, deploy" },
  { id: "stack", label: "Stack", hint: "Frameworks, tools" },
  { id: "mcp", label: "MCP", hint: "Servers for agents" },
  { id: "sandbox", label: "Sandbox", hint: "Network, proxy, secrets" },
  { id: "boards", label: "Boards", hint: "Progress boards" },
  { id: "project", label: "Project", hint: "Repo, HQ, token budgets" },
];

export function SettingsModal() {
  const settings = useUi((s) => s.settings);
  const reduce = useReducedMotion();
  if (!settings) return null;

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center backdrop p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onMouseDown={(e) => e.target === e.currentTarget && ui.closeSettings()}
    >
      <motion.div
        initial={reduce ? false : { y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="panel flex h-[min(760px,calc(100dvh-2rem))] w-[min(1080px,100%)] flex-col"
      >
        <TitleBar title="Settings" onClose={() => ui.closeSettings()} />
        <p className="m-0 border-b border-ink bg-platinum px-4 py-1 text-[12px]">Changes apply right away.</p>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[200px] shrink-0 flex-col border-r border-ink bg-platinum" aria-label="Settings sections">
            {TABS.map((t) => (
              <button key={t.id} className="nav-row" aria-pressed={settings.tab === t.id} onClick={() => ui.openSettings(t.id, settings.agentId)}>
                <div className="text-[14px] font-semibold">{t.label}</div>
                <div className="text-[12px]">{t.hint}</div>
              </button>
            ))}
          </nav>
          <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-4">
            {settings.tab === "team" && <TeamSettings />}
            {settings.tab === "workflow" && <WorkflowSettings />}
            {settings.tab === "stack" && <StackSettings />}
            {settings.tab === "mcp" && <McpSettings />}
            {settings.tab === "sandbox" && <SandboxSettingsTab initialAgentId={settings.agentId} />}
            {settings.tab === "boards" && <BoardsSettings />}
            {settings.tab === "project" && <ProjectSettings />}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
