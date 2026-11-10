import { useOffice } from "../../store/office";
import { ErrorNote } from "../kit";

/** Shown when the real HQ server is unreachable. */
export function ConnectionBanner() {
  const live = useOffice((s) => s.live);
  const connection = useOffice((s) => s.connection);
  const ready = useOffice((s) => s.snap !== null);
  const persistent = useOffice((s) => s.snap?.setup.machine.persistentAgents ?? true);
  if (!live || connection === "open" || (connection === "connecting" && !ready)) return null;
  const unauthorized = connection === "unauthorized";
  return (
    <div className="fixed left-1/2 top-[44px] z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2">
      <ErrorNote title={unauthorized ? "HQ restarted with a new link." : "Lost connection to HQ."} role="status">
        {unauthorized ? "Open the URL printed in your terminal." : `Reconnecting…${persistent ? " Agents keep running in tmux." : ""}`}
        {!unauthorized && (
          <div className="progress mt-2" aria-hidden>
            <i />
          </div>
        )}
      </ErrorNote>
    </div>
  );
}
