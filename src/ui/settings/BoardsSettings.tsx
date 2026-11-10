import { useState } from "react";
import type { BoardStatus } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { SectionTitle } from "../kit";
import { CommitInput } from "./controls";

export function BoardsSettings() {
  const snap = useOffice((s) => s.snap);
  const [title, setTitle] = useState("");
  if (!snap) return null;
  const boards = [...snap.boards].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>Boards · {boards.length}</SectionTitle>
        <p className="mb-3 text-[14px] text-ink-2">
          A project can have many boards: one per phase, or one per area. Agents pick work only from active boards. The lead tops up active boards when they run low.
        </p>
        <div className="flex flex-col gap-2">
          {boards.map((b) => {
            const tasks = snap.tasks.filter((t) => t.boardId === b.id);
            const done = tasks.filter((t) => t.status === "done").length;
            return (
              <div key={b.id} className="grid grid-cols-[60px_1fr_140px_120px] items-center gap-3 border border-ink bg-white px-3 py-2">
                <span className="font-term text-[19px] text-ink-2">{b.id}</span>
                <CommitInput className="field" value={b.title} onCommit={(v) => v.trim() && officeActions.updateBoard(b.id, { title: v.trim() })} />
                <select className="field" value={b.status} onChange={(e) => officeActions.updateBoard(b.id, { status: e.target.value as BoardStatus })} aria-label={`${b.title} status`}>
                  <option value="active">Active</option>
                  <option value="planned">Planned</option>
                  <option value="done">Done</option>
                </select>
                <span className="text-right font-term text-[17px] text-ink-2">
                  {done}/{tasks.length} done
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <form
        className="flex items-end gap-2 border border-ink p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          officeActions.createBoard(title);
          setTitle("");
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[14px] font-semibold">New board</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Phase 7 — Mobile" />
        </label>
        <button className="btn" type="submit" disabled={!title.trim()}>
          Create
        </button>
      </form>
    </div>
  );
}
