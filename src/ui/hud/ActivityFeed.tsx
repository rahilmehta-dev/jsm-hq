import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ActivityEvent, ActivityType } from "../../data/types";
import { useOffice } from "../../store/office";
import { ago, TitleBar, useNow } from "../kit";

const INK = "#000000";
const BAD = "#b3261e";
const OK = "#1d7a3a";
// Three colours only: ink for neutral events, red for trouble, green for good news.
const ICON: Record<ActivityType, [string, string]> = {
  "task.assigned": ["▸", INK],
  "task.started": ["●", INK],
  "task.created": ["+", INK],
  "agent.needs-input": ["!", BAD],
  "agent.answered": ["✓", OK],
  message: ["✉", INK],
  "pr.opened": ["⇡", INK],
  "review.started": ["◎", INK],
  "review.passed": ["✓", OK],
  "review.changes": ["✗", BAD],
  "pr.merged": ["⇢", OK],
  deploy: ["▲", INK],
  session: ["◆", INK],
  config: ["⚙", INK],
};

const EMPTY: ActivityEvent[] = [];

export function ActivityFeed() {
  const activity = useOffice((s) => s.snap?.activity ?? EMPTY);
  const now = useNow(1000);
  const reduce = useReducedMotion();
  const items = activity.slice(0, 7);

  return (
    <section aria-label="Activity" className="panel fixed bottom-4 left-4 z-10 flex h-[220px] w-[280px] flex-col">
      <TitleBar title="Activity" right={<i className="led" />} />
      <ul className="m-0 min-h-0 flex-1 list-none overflow-hidden p-0 text-[13px] leading-[1.4]" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((e) => {
            const [icon, color] = ICON[e.type];
            return (
              <motion.li
                key={e.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className="flex gap-1.5 border-b border-ink px-2.5 py-[3px]"
              >
                <span className="w-3 shrink-0 text-center" style={{ color }}>
                  {icon}
                </span>
                <span className="min-w-0 flex-1 truncate" title={e.text}>
                  {e.text}
                </span>
                <time className="shrink-0 text-ink-2">{ago(e.at, now)}</time>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
