import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ILinkProvider } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { officeActions } from "../../store/office";
import { readTerminal, subscribeTerminal } from "../../store/terminal";
import { FONT_EVENT, savedFont, terminalFont, type FontStyle } from "../../theme/fonts";

const theme = {
  background: "#101418",
  foreground: "#dfe6ff",
  cursor: "#dfe6ff",
  cursorAccent: "#101418",
  selectionBackground: "#2c3b6b",
  black: "#241a2e",
  red: "#ff5c86",
  green: "#6cf08a",
  yellow: "#ffc14d",
  blue: "#29adff",
  magenta: "#ff77a8",
  cyan: "#3ee0d0",
  white: "#dfe6ff",
};

/** A link from a terminal, if it's a web link. A terminal's output is untrusted. */
function webLink(uri: string): string | null {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Links a program broke across lines itself, with real line breaks at the terminal's width. A long
 * sign-in URL from Antigravity CLI inside tmux is printed this way, so the terminal sees one link
 * per line (the web-links addon only joins lines the terminal wrapped). A URL starts at "http" on
 * some line, then every line that fills the width continues it, up to the first shorter line.
 */
interface WrappedUrl {
  url: string;
  top: number; // first and last buffer line (1-based) and the column the URL starts at
  end: number;
  startX: number;
  /** The last line fills the width: the program is probably showing only part of the URL (a pager, a short window). */
  cut: boolean;
}

/** The URL a program broke across lines that includes buffer line `y`, or null. */
function wrappedUrlAt(term: Terminal, y: number): WrappedUrl | null {
  const buf = term.buffer.active;
  const line = (n: number) => buf.getLine(n - 1)?.translateToString(true) ?? "";
  const word = (s: string) => s.trim() !== "" && !/\s/.test(s.trim()); // one unbroken run of text
  const startsUrl = (s: string) => /(^|\s)https?:\/\/\S*$/.test(s.trimEnd()); // lines are padded with a space on the right
  // The width the program wrapped at is what its full lines measure, which isn't always this
  // terminal's width (tmux sizes a pane to one of the browser tabs that show it).
  // Walk up to the line the URL starts on: the last word on it begins with http(s)://.
  let top = y;
  let first = line(top);
  while (!startsUrl(first)) {
    const prev = line(top - 1);
    if (top <= 1 || !word(first) || prev.length < Math.max(30, first.length) || !(word(prev) || startsUrl(prev))) return null;
    first = prev;
    top--;
  }
  const width = first.length;
  const startX = first.trimEnd().search(/\S+$/) + 1;
  const parts = [first.slice(startX - 1).trim()];
  let end = top;
  // Every line the program filled to the full width continues the URL; the first shorter one ends it.
  while (width >= 30 && line(end).length === width && end < buf.length) {
    const next = line(end + 1).trim(); // the program indents its lines by a column or two
    if (!word(next) || /^https?:\/\//.test(next)) break;
    parts.push(next);
    end++;
  }
  // One line is the web-links addon's; a link that ends above the line asked about isn't this one.
  if (end === top || end < y) return null;
  return { url: parts.join(""), top, end, startX, cut: line(end).length === width };
}

function hardWrappedLinks(term: Terminal, open: (uri: string) => void): ILinkProvider {
  return {
    provideLinks(y, done) {
      const w = wrappedUrlAt(term, y);
      const last = w && (term.buffer.active.getLine(w.end - 1)?.translateToString(true).length ?? 0);
      done(w ? [{ range: { start: { x: w.startX, y: w.top }, end: { x: last ?? 1, y: w.end } }, text: w.url, activate: (_e, text) => open(text) }] : undefined);
    },
  };
}

/**
 * The last wrapped URL on screen (the first line a URL starts on, bottom-most). Selecting text in a
 * live program fails: it repaints and clears the selection, and a mouse-aware program (or tmux) takes
 * the drag, so this is what the "Copy link" button copies.
 */
function lastWrappedUrl(term: Terminal): { url: string; cut: boolean } | null {
  const buf = term.buffer.active;
  let found: { url: string; cut: boolean } | null = null;
  for (let y = buf.baseY + 1; y <= buf.baseY + term.rows; y++) {
    const w = wrappedUrlAt(term, y);
    if (w && w.top === y) {
      found = { url: w.url, cut: w.cut };
      y = w.end;
    }
  }
  return found;
}

/** Copies text from a click. Falls back to the old execCommand route where the clipboard API is blocked. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/**
 * Opens a link in a new tab. Called from a click, so pop-up blockers (Safari's especially) allow
 * it. If the browser blocks it anyway, copies the link instead and says so.
 */
function openOrCopy(href: string, say: (text: string) => void) {
  const tab = window.open(href, "_blank");
  if (tab) {
    tab.opener = null;
    return;
  }
  navigator.clipboard
    .writeText(href)
    .then(() => say("Your browser blocked the new tab. Link copied: paste it in a new tab."))
    .catch(() => say("Your browser blocked the new tab. Select the link and copy it."));
}

/** A real xterm.js terminal fed by the agent's (mock) output stream. */
export function TerminalView({ agentId, autoFocus = true }: { agentId: string; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wrappedUrl, setWrappedUrl] = useState<{ url: string; cut: boolean } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const font = terminalFont(savedFont());
    // xterm activates links on mouseup, which Safari doesn't count as a click for opening tabs.
    // Remember the link there and open it on the click that follows.
    let pendingLink: string | null = null;
    const term = new Terminal({
      theme,
      fontFamily: font.family,
      fontSize: font.size,
      lineHeight: font.lineHeight,
      cursorBlink: true,
      scrollback: 3000,
      convertEol: false,
      allowProposedApi: false,
      // Links a program marks as links (OSC 8), e.g. with FORCE_HYPERLINK set: the full URL, however it wraps.
      linkHandler: { activate: (_e, uri) => (pendingLink = webLink(uri)), allowNonHttpProtocols: false },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Registered first: the first provider with a link under the pointer wins, and this one covers the whole URL.
    term.registerLinkProvider(hardWrappedLinks(term, (uri) => (pendingLink = webLink(uri))));
    // Plain URLs in the output, including ones the terminal wrapped onto the next line.
    term.loadAddon(new WebLinksAddon((_e, uri) => (pendingLink = webLink(uri))));
    const onClick = () => {
      const href = pendingLink;
      pendingLink = null;
      if (href) openOrCopy(href, setNotice);
    };
    el.addEventListener("click", onClick, true);
    let unsub = () => {};
    let ro: ResizeObserver | null = null;
    let scanTimer = 0;

    // Font style changed in Settings: switch once the new font is loaded, then re-measure.
    const onFont = (e: Event) => {
      const f = terminalFont((e as CustomEvent<FontStyle>).detail);
      void document.fonts.load(f.load).finally(() => {
        if (disposed) return;
        term.options.fontFamily = f.family;
        term.options.fontSize = f.size;
        term.options.lineHeight = f.lineHeight;
        try {
          fit.fit();
        } catch {
          /* not open yet */
        }
      });
    };
    window.addEventListener(FONT_EVENT, onFont);

    // Measure with the font loaded, or columns come out wrong.
    void document.fonts.load(font.load).finally(() => {
      if (disposed) return;
      term.open(el);
      fit.fit();
      // The server sizes the agent's tmux window to this terminal and redraws it.
      officeActions.resizeTerminal(agentId, term.cols, term.rows);
      term.onResize(({ cols, rows }) => officeActions.resizeTerminal(agentId, cols, rows));
      term.write(readTerminal(agentId));
      unsub = subscribeTerminal(agentId, (data) => term.write(data));
      // Offer a "Copy link" button while a wrapped URL (a sign-in link, say) is on screen.
      // At most twice a second, never postponed: a program that repaints constantly would starve a debounce.
      const scan = () => {
        scanTimer = 0;
        if (disposed) return;
        const next = lastWrappedUrl(term);
        // Keep the same object while nothing changed, so a repainting program doesn't re-render this view.
        setWrappedUrl((prev) => (prev?.url === next?.url && prev?.cut === next?.cut ? prev : next));
      };
      const queueScan = () => {
        if (!scanTimer) scanTimer = window.setTimeout(scan, 500);
      };
      term.onWriteParsed(queueScan);
      queueScan();
      term.onData((data) => officeActions.sendTerminalInput(agentId, data));
      // Shift+Enter: xterm.js sends a plain Enter (\r), which submits. Send Alt+Enter (ESC \r)
      // instead, which Claude Code and Codex read as "new line".
      term.attachCustomKeyEventHandler((e) => {
        if (e.key !== "Enter" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return true;
        if (e.type === "keydown") officeActions.sendTerminalInput(agentId, "\x1b\r");
        e.preventDefault();
        return false;
      });
      ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* element hidden mid-animation */
        }
      });
      ro.observe(el);
      if (autoFocus) term.focus();
    });

    return () => {
      disposed = true;
      window.clearTimeout(scanTimer);
      window.removeEventListener(FONT_EVENT, onFont);
      el.removeEventListener("click", onClick, true);
      unsub();
      ro?.disconnect();
      term.dispose();
    };
  }, [agentId, autoFocus]);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={host} className="h-full min-h-0 w-full bg-well" />
      {wrappedUrl && (
        <button
          className="btn absolute right-3 top-2 z-10 px-2 text-[13px]"
          title="Copies the whole link, even though the program wrapped it across lines."
          onClick={() =>
            void copyText(wrappedUrl.url).then((ok) =>
              setNotice(
                !ok
                  ? "Couldn't copy. Open the link from the terminal instead."
                  : wrappedUrl.cut
                    ? "Copied, but only part of the link is on screen. Make this terminal taller (or maximize it) and copy again."
                    : "Link copied. Paste it in a new browser tab.",
              ),
            )
          }
        >
          Copy link
        </button>
      )}
      {notice && (
        <div role="status" className="absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 border-2 border-ink bg-yellow px-2 py-1 text-[13px] text-ink">
          {notice}
        </div>
      )}
    </div>
  );
}
