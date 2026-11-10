import { useEffect, useState } from "react";
import type { AgentConfig } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { Busy } from "../kit";

/** Confirms removing an agent and lets you choose what to delete with it. */
export function RemoveAgentDialog({ agent, onClose }: { agent: AgentConfig; onClose: () => void }) {
  const info = useOffice((s) => s.workspaceInfo[agent.id]);
  const [asked, setAsked] = useState(false);
  const [deleteSandbox, setDeleteSandbox] = useState(true);
  const [deleteFolder, setDeleteFolder] = useState(false);

  useEffect(() => {
    // Drop any stale answer, then ask the server for the folder's current state.
    useOffice.setState((s) => {
      const next = { ...s.workspaceInfo };
      delete next[agent.id];
      return { workspaceInfo: next };
    });
    officeActions.inspectWorkspace(agent.id);
    setAsked(true);
  }, [agent.id]);

  const loading = asked && !info;
  const atRisk = info ? info.changedFiles + info.unpushedCommits > 0 : false;
  const remove = () => {
    officeActions.removeAgent(agent.id, { deleteSandbox, deleteFolder: deleteFolder && !!info?.managed });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={`Remove ${agent.name}`}>
      <div className="alert w-[min(560px,100%)] bg-paper p-4">
        <h3 className="mb-1 text-[17px] font-bold">Remove {agent.name} from the team?</h3>
        <p className="mb-3 text-[13px] text-ink-2">Their session stops, and their unfinished tasks go back to the board.</p>

        {loading && (
          <div className="mb-3">
            <Busy>Checking {agent.name}'s folder…</Busy>
          </div>
        )}

        {info && (
          <div className="mb-3 flex flex-col gap-3">
            <label className={`flex items-start gap-2 border border-ink bg-white p-2 ${info.sandboxExists ? "" : "stopped"}`}>
              <input type="checkbox" className="mt-1" checked={deleteSandbox && info.sandboxExists} disabled={!info.sandboxExists} onChange={(e) => setDeleteSandbox(e.target.checked)} />
              <span className="min-w-0">
                <b className="text-[15px]">Delete {agent.name}'s sandbox (the VM)</b>
                <span className="block font-term text-[16px] text-ink-2">{info.sandboxExists ? `sbx rm ${info.sandboxName}` : "No sandbox exists"}</span>
                <span className="block text-[12px] text-ink-2">Safe: the code lives in the folder, not the VM. Anything installed inside the VM is lost.</span>
              </span>
            </label>

            <label className={`flex items-start gap-2 border p-2 ${atRisk && deleteFolder ? "border-ink bg-bad-fill" : "border-ink bg-white"} ${info.managed && info.exists ? "" : "stopped"}`}>
              <input type="checkbox" className="mt-1" checked={deleteFolder} disabled={!info.managed || !info.exists} onChange={(e) => setDeleteFolder(e.target.checked)} />
              <span className="min-w-0">
                <b className="text-[15px]">Delete {agent.name}'s folder</b>
                <span className="block truncate font-term text-[16px] text-ink-2" title={info.path}>{info.path}</span>
                {!info.managed && <span className="block text-[12px] text-ink-2">This is your own folder, so HQ never deletes it.</span>}
                {info.managed && !info.exists && <span className="block text-[12px] text-ink-2">The folder doesn't exist.</span>}
                {info.managed && info.exists && (
                  <span className={`block text-[12px] ${atRisk ? "font-semibold text-mark-bad" : "text-ink-2"}`}>
                    {atRisk
                      ? `Warning: ${[info.unpushedCommits ? `${info.unpushedCommits} commit${info.unpushedCommits > 1 ? "s" : ""} not pushed` : "", info.changedFiles ? `${info.changedFiles} file${info.changedFiles > 1 ? "s" : ""} changed` : ""].filter(Boolean).join(" · ")} — deleting loses them.`
                      : "Everything here is committed and pushed."}
                  </span>
                )}
              </span>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn btn-default" autoFocus onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={loading} onClick={remove}>
            Remove {agent.name}
          </button>
        </div>
      </div>
    </div>
  );
}
