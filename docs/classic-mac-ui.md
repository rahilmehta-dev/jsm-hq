# Classic Mac UI: audit and design plan

Phase 1 (SEE) of the Classic Mac + Jony Ive restyle (board CMU). This document records what the UI looks like today on demo data, where it falls short, and exactly what Phases 2–5 will change. It changes no code.

**Method.** The audit was done from source (`src/index.css`, `src/theme/tokens.ts`, every file in `src/ui/`, `src/office/engine/palette.ts`, the 3×5 label font) and from computed WCAG contrast ratios of the real color pairs. The sandbox has no browser, so nothing here is from a screenshot. Where a finding depends on rendered size (label readability), it is flagged **verify visually** for the Phase 2 reviewer. Demo data is what `pnpm dev` runs (`src/data/mock/`), shown by the "Demo data" chip in the top bar.

## 1. Design intent

Classic Mac (System 6/7/Platinum) supplies the *structure*; Jony Ive supplies the *restraint*.

| Principle | Means here |
|---|---|
| Flat, honest materials | Solid fills, 1px hard borders, one offset drop shadow. No gradients, glow, blur or glossy highlights. |
| Black-and-white first | Chrome is white / light gray with black ink. Color is reserved for meaning (agent state, review state). |
| Windows are objects | Panels and drawers read as Mac windows: title bar, close box, 1px black frame, hard shadow. |
| Legibility is non-negotiable | Text ≥ 4.5:1, large text and icons ≥ 3:1, no text smaller than 12px. |
| Calm | Few saturated areas, generous even spacing, one accent. Personality comes from small touches, not decoration. |
| One grid | 4px spacing unit. Everything snaps to it. |

The current "campus" look (soft rounded cards, 16px radii, blurry shadows, warm white) is already flat and quiet, so it is a good base. The gap is that it is *generic modern SaaS*, not Classic Mac, and it still carries leftovers from the earlier PICO-8 game look.

## 2. Audit on demo data

### 2.1 Global chrome (`src/index.css`, `kit.tsx`)

| # | Finding | Where |
|---|---|---|
| G1 | **Two visual languages in one UI.** `.panel`/`.btn`/`.field` are soft-modern (16px/10px radii, 12–32px blurred shadows), but `Portrait`, `Dot`, `ConnectionBanner`, all of Settings and Setup use `border-[3px] border-ink` hard pixel frames (33 uses in 10 files). | `index.css`, `kit.tsx`, `settings/*`, `setup/*` |
| G2 | **Blurred shadows** (`0 12px 32px`) on every panel. Not Classic Mac; also the main source of "fake depth". | `.panel`, `.panel-dark` |
| G3 | **Leftover saturated PICO-8 tokens** exposed as Tailwind colors: `--color-red #ff004d`, `green #00e436`, `blue #29adff`, `orange #ffa300`, `pink`, `lav`. They are used both as fills and as text. | `@theme` |
| G4 | **Body background is the grass green** (`#4a8f3d`) behind everything, so every HUD element that sits directly on the canvas inherits a mid-tone green backdrop. | `body` |
| G5 | **Radii and padding drift.** Radii: 6, 10, 16, 999. Button padding `3px 12px`, `px-1.5`, `px-2`, `px-2.5`, `px-0` all appear. Font sizes: 11, 12, 13, 14, 15, 16, 17, 18, 22, 24px (about 250 arbitrary `text-[Npx]` values). | everywhere |
| G6 | `.led` uses a `box-shadow` halo and a blink animation; the top bar "Sandbox" pill is a rounded-full capsule. Both are modern-glow idioms. | `.led`, `TopBar` |
| G7 | **Fonts.** Default is Inter (fine). `font-term` (JetBrains Mono / VT323) is used for numbers, ids and the activity feed, mixing a third family into dense rows. | `index.css`, `TeamPanel`, `ActivityFeed` |

### 2.2 HUD

**Top bar (`TopBar.tsx`).** A single 52px floating pill with up to 12 controls in one row at a minimum width of 1280px: logo, name, demo chip, project, plan-wall select (190px), speed, zoom, sandbox pill, Setup, Action items, Boards, PRs, Terminal, Settings, Debug.
- T1 *Clutter.* Two groups of text buttons plus a capsule plus a select compete at the same weight. Nothing is primary. Debug is shown to every user.
- T2 The plan-wall select is a board-switcher living in the global bar; it is the widest element and rarely used. Candidate for a menu item.
- T3 Attention state is a flat yellow fill (`#f6e9b8`) on "Action items": fine and flat, but it is an inline style, not a token.
- T4 Everything is 13px; the only hierarchy is the 17px product name.
- T5 The logo SVG hard-codes `#1f2421/#3f8f5a/#fff6e9/#1d2b53/#ffec27` (a saturated yellow antenna).

**Team panel (`TeamPanel.tsx`).** Each agent is a full `.panel` card (blurred shadow ×N), so a 6-agent team is six floating cards.
- P1 *Visual clutter.* Each card stacks portrait, name, role · CLI · model, state chip, elapsed time, up to three more chips, a kbd hint and a task line: five rows of 11–17px text in 280px.
- P2 Needs-input is a 3px `#ff004d` outline, the loudest thing on screen by design, but also the *only* thing using that red at full saturation, so it works. Keep the signal, make it a Mac-style 2px black frame plus a solid marker.
- P3 Section header "Team · N" is cream text with a hard `text-shadow` on the green lawn: 3.81:1 (fails body-text 4.5:1; passes large text only because it is 13px **bold uppercase**, which is *not* large text by WCAG). **Fail.** The "N need you" run is yellow on the same green: 3.27:1. **Fail.**
- P4 Focus indicator `▶` is an unstyled glyph positioned at `-left-4`, outside the card.
- P5 Time-since text in `font-term` 16px muted gray on cream.

**Activity feed (`ActivityFeed.tsx`).** Dark translucent panel, 220px high, 7 rows at `font-term` 17px/`leading-none`.
- A1 `panel-dark` is the only dark surface in an otherwise light UI, and it is at 92% opacity (translucent over the canvas: contrast varies with what is behind).
- A2 Timestamps `#7f8bb5` on `#1f2421`: 4.70:1 (barely passes, and only if the translucency doesn't lighten the background). Row dividers are dashed 15%-alpha lines.
- A3 Event icons are saturated pink/red/green/cyan glyphs (`#ff5c86 #6cf08a #3ee0d0 #ffc14d`). They pass 3:1 individually but there are 8 different hues, which reads as confetti.
- A4 `leading-none` on 17px text leaves no line gap: ascenders and descenders of adjacent rows nearly touch.

**Connection banner / tooltips / debug panel.** `ConnectionBanner` still uses `border-[3px]` pixel framing. `DebugPanel` uses `#66729f` for secondary text on the dark panel: 3.36:1 (**fail**, 9 uses).

### 2.3 Drawers

`Drawer.tsx` gives all drawers one shell: a header row (`border-b border-line`, title, maximize, ✕) over a body.
- D1 *Close box.* ✕ and maximize are generic `.btn` squares at the right. Classic Mac puts a close box at the **left** of a ruled title bar. Currently the header is plain, with no title-bar identity.
- D2 Body surfaces vary by drawer: `bg-cream`, `bg-cream-2`, `bg-white`, `bg-[#f7f3ea]`, `bg-[#e8e1d2]`, `bg-[#dcf7e3]`: **six near-identical off-whites** chosen ad hoc, with a few warm yellow-beiges that don't match the cool gray campus tokens.
- D3 Highlight fills `bg-[#fff1d6]`, `bg-[#fff3cf]`, `bg-[#ffe1ea]`, `bg-[#dcf7e3]` (pale orange, yellow, pink, green) are used as badges/rows; fine in contrast (ink on pastel ≥ 12:1) but each is a one-off.
- D4 Agent drawer (`AgentDrawer.tsx`, 494 lines): the busiest screen. Terminal area uses the navy PICO palette (`bg-navy-2`, `#dfe6ff`, `#9aa6d1`); in Mac terms that is a large saturated-blue block next to a gray window. Secondary copy `text-[13px] text-[#9aa6d1]` on navy is fine (≈6:1) but the 11px notes (`text-[11px] text-muted`, line 489) are below the 12px floor.
- D5 Small buttons `btn px-1.5 text-[11px]` (PR drawer, blocked-request actions): 11px label, ~20px tall target. Under the 12px floor and below a comfortable hit target.
- D6 Action items drawer / PR drawer / Boards drawer use three different row layouts for the same "item + status chip + action" pattern.

### 2.4 Settings and Setup

All of `settings/*` and `setup/*` use `border-[3px] border-ink` frames, `font-semibold uppercase tracking-[0.12em]` section titles, and `Tabs` rendered as a row of `.btn`.
- S1 *Inconsistent with the HUD.* Heavy 3px black pixel borders around sections inside a modal that is itself a soft rounded `.panel`. This is the clearest example of the two languages (G1).
- S2 `SectionTitle` is 13px bold uppercase muted gray on cream (4.79:1 on `cream`, **4.35:1 on `cream-2`: fail**).
- S3 `Field` hint text is `text-[12px] text-muted`. Passes on `cream` (4.79) but fails when a panel uses `cream-2` (4.35) or `cream-3` (3.79).
- S4 Tabs are buttons with `aria-pressed` styling (pale green); selected state is color-only, with no structural cue.
- S5 `TeamSettings` (447 lines) and `McpSettings` (245) are long, single-column forms with many 12px muted hints: dense.
- S6 `controls.tsx` toggles/checkboxes: verify visually that on/off differs by more than color (needs a check mark/position).

### 2.5 Office canvas (campus)

Colors in `src/office/engine/palette.ts` are already calm: warm grays, sage, soft greens, glass. Remaining issues:
- C1 *Label legibility.* In-world labels use the custom **3×5 bitmap font** (`engine/font.ts`, uppercase only). At 1× scale a glyph is 5px high. Readable only when the camera is zoomed in (`fitZoom()+1`, max 4). **At default fit zoom, section signs and name tags are 5–10 screen pixels tall: verify visually; likely below any legibility floor.** Tags (`tag()`) put 1-bit text on `ink`/`white` plates, so contrast is fine (white on `#3b403c` is 10.6:1); size is the problem, not color.
- C2 *Saturated blocks in-world.* The PICO state colors are still used at full saturation on the canvas: `red #ff004d`, `green #00e436`, `blue #29adff`, `orange #ffa300`, `yellow #ffec27`, plus `rabbit #ff7a30`, `gold #ffcf3a`. Section signs use `#d97757 #3aa675 #4a86e8 #8e6bd1`. Against the quiet beige floor they are the loudest thing on the map. Intended for status but also used for decoration.
- C3 Lawn is `grass #8dbb78` plus the body background `#4a8f3d` at the edges: two different greens with a visible seam if the camera shows past the lawn; also a saturated field that fights the neutral UI (G4).
- C4 Agent robots use a 12-color saturated palette (`agentPalette`). This is *identity*, not decoration, so it stays, but the body-color shading (`shade()`) should lose its gloss highlight in Phase 4.

## 3. Contrast audit

Computed WCAG 2.x ratios of real pairs. Targets: text ≥ 4.5:1, large text (≥ 18.66px bold or ≥ 24px) and non-text/icons ≥ 3:1.

| Pair (foreground on background) | Ratio | Result | Used for |
|---|---|---|---|
| ink `#1f2421` on cream `#fbfaf8` | 15.11 | pass | body text |
| muted `#6b716c` on cream | 4.79 | pass (thin) | secondary text |
| muted on cream-2 `#f1efea` | 4.35 | **FAIL** | section titles, hints in tinted areas |
| muted on cream-3 `#e3e0d9` | 3.79 | **FAIL** | pressed/hover states with muted text |
| accent `#3f8f5a` on cream | 3.81 | **FAIL as text**, pass as icon | accent text/links |
| red `#ff004d` on cream | 3.76 | **FAIL as text** | needs-input note in team card |
| orange `#ffa300` on cream | 1.92 | **FAIL** | any orange text |
| green `#00e436` on cream | 1.66 | **FAIL** | any green text |
| blue `#29adff` on cream | 2.36 | **FAIL** | any blue text |
| ink on chip blue `#29adff` | 6.39 | pass | Working chip |
| ink on chip red `#ff004d` | 4.02 | **FAIL** | Needs-input chip |
| ink on chip orange `#ffa300` | 7.87 | pass | In-review chip |
| ink on chip green `#00e436` | 9.12 | pass | Review-passed chip |
| ink on chip lavender `#83769c` | 3.78 | **FAIL** | Idle / Queued chip |
| white on merged green `#00873a` | 4.64 | pass | Merged chip |
| cream on lawn `#4a8f3d` | 3.81 | **FAIL** (bold 13px is not "large") | Team header |
| yellow `#ffec27` on lawn | 3.27 | **FAIL** | "N need you" |
| `#66729f` on dark `#1f2421` | 3.36 | **FAIL** | Debug panel (9 uses) |
| `#7f8bb5` on dark | 4.70 | pass (thin) | feed timestamps |
| `#9aa6d1` / `#b9c3e6` on dark | 6.57 / 9.01 | pass | feed/debug labels |
| `#a35d00` on `#fff1d6` | 4.56 | pass (thin) | "waiting" amber text |
| panel border `#dedbd3` vs cream | 1.33 | **FAIL as component boundary** (needs ≥ 3:1 or another cue) | all panels, `.btn`, `.field` |
| panel border vs lawn green | 2.87 | n/a (decorative; shadow supplies the edge) | |

**Summary of structural failures:**
1. Saturated state colors cannot be text colors on light surfaces (orange, green, blue, red < 4:1). Any state-colored *text* must use a dark variant or move into a chip with ink text.
2. `--color-muted` is only safe on `cream`/white, and `cream-2` and `cream-3` are used as backgrounds for muted text.
3. Hairline borders (`--color-line`) don't separate controls (1.33:1). Inputs and buttons need a 1px **ink-based** border (≥ 3:1) to be perceivable as controls.
4. Two chips (Needs input, Idle/Queued) fail with ink text.
5. HUD text placed directly on the lawn fails.

## 4. Specs for Phases 2–5

Files in each phase are the *expected* set; the owner of the phase confirms scope with the lead.

### Phase 2 (CMU-T02): Foundations

Tokens and primitives only; no layout changes. Files: `src/index.css`, `src/theme/tokens.ts`, `src/ui/kit.tsx`.

**Tokens (CSS custom properties in `@theme`):**

```
--color-paper:      #ffffff   /* window background */
--color-platinum:   #dddddd   /* chrome, raised surfaces, title bars */
--color-platinum-2: #c8c8c8   /* pressed / inset */
--color-desk:       #a8a8a8   /* app backdrop (replaces grass-green body bg) */
--color-ink:        #000000   /* text, borders (was #1f2421) */
--color-ink-2:      #4d4d4d   /* secondary text: 8.45:1 on paper, 6.2:1 on platinum */
--color-select:     #3a5a8c   /* selection / focus / primary accent, 6.95:1 on white */
--color-select-ink: #ffffff
```

State colors are split into a **chip fill** (light, used with ink text) and a **mark** (the saturated hue, used only for dots and icons, ≥ 3:1 against the chip fill and against paper):

| State | Fill (ink text ≥ 7:1) | Mark (≥ 3:1) |
|---|---|---|
| working | `#cfe4f5` | `#1b6ca8` |
| needs-input | `#f6cfcf` | `#b3261e` |
| in-review | `#f5e2b8` | `#946000` |
| review-passed | `#cfe9d5` | `#1d7a3a` |
| idle / queued | `#e4e4e4` | `#5c5c5c` |

(Checked with the §6 formula: ink on every fill ≥ 14.7:1; every mark ≥ 4.17:1 on its fill and ≥ 5.3:1 on white. Phase 2 re-verifies in the Vitest.)

**Materials.**
- Shadow: one token, `--shadow-window: 2px 2px 0 #000`. Remove all blurred shadows.
- Radii: window 0–2px, controls 4px, chips 2px. Remove the 16px/999px radii.
- Border: `1px solid #000` on windows, buttons and fields. Interior dividers `1px #000` or a 50% dither line.
- `.btn`: platinum fill, 1px black border, 4px radius, **inset bevel as two flat 1px lines** (white top/left, `#808080` bottom/right: flat solid lines, not gradients). Pressed: invert to ink fill with white text. Disabled: 50% dither pattern over the label, not opacity.
- `.field`: white, 1px black border, 1px inset shadow line. Focus: 2px `--color-select` outline (visible ≥ 3:1).
- Texture: one optional 2×2 checker (`#fff`/`#ddd`) as `--bg-desk-pattern`, used only on the desktop backdrop and scrollbars. No other textures.
- `.led`: solid 8px square/circle, no halo. Blink stays but `prefers-reduced-motion` already disables it.

**Type scale (replace arbitrary `text-[Npx]`):** `--text-xs: 12px` (minimum), `--text-sm: 13px`, `--text-md: 14px`, `--text-lg: 17px`, `--text-xl: 22px`. Add Tailwind `@theme` entries so classes are `text-xs`…`text-xl`. Nothing below 12px; fix the ten 11px uses. Line-height ≥ 1.35 for any text that wraps; `leading-none` only for single-line numerals.
- UI face: keep Inter as default (best legibility); **do not add a bitmap Chicago face** as default. The "pixel" font choice in Settings stays as an opt-in. System-style flavor comes from chrome, not from the type.

**Spacing:** 4px base; allowed paddings `4 / 8 / 12 / 16 / 24`. Buttons: `padding: 4px 12px`, min-height 24px (28px for primary row actions).

**Kit changes:** `StateChip`/`ReviewChip` take fill+mark from the table; `Dot` uses a 1px black border and no 2px pixel frame; `Portrait` gets `border-2 → 1px` black and a flat platinum plate instead of `bg-navy`; `SectionTitle` becomes 12px bold ink-2 sentence-case-or-caps with a 1px rule beneath (not muted gray). `Tabs` become real tabs: the selected tab is joined to the content (no bottom border), unselected tabs are platinum.

**Contrast standard (CI-ish).** Add `src/theme/contrast.test.ts` (Vitest) that asserts every documented foreground/background token pair meets its target (4.5 text, 3 large text/icon/boundary). This makes §3 regressions impossible to ship.

### Phase 3 (CMU-T03): Windows and drawers

Files: `src/ui/drawers/*`, `src/ui/hud/TopBar.tsx`, `src/ui/hud/TeamPanel.tsx`, `src/ui/hud/ActivityFeed.tsx`, `src/ui/settings/SettingsModal.tsx`, `src/ui/setup/*`, `src/ui/hud/ConnectionBanner.tsx`, `src/ui/DebugPanel.tsx`.

**Window frame (`.window` class + `<Window>` in `kit.tsx`).** 1px black border, `--shadow-window`, 0–2px radius, white body. **Title bar:** 20px tall, platinum with 6 horizontal 1px black pinstripes (CSS `repeating-linear-gradient`, solid stops: a texture, not a gloss), **close box** (11×11, 1px black, white fill) at the left, centered bold title on a platinum "label" patch that interrupts the stripes, and the maximize ("zoom box") at the right. Inactive windows: stripes removed, title in ink-2.

**Drawers.** Header → title bar as above (replaces `DrawerHeader`'s border-b row). One body surface: `paper`. Replace the six ad-hoc off-whites (D2) with `paper` / `platinum` only. List rows share one `ListRow` (item · status chip · action) used by Action items, PRs and Boards (D6). Buttons ≥ 12px; delete `px-1.5 text-[11px]` (D5). The agent terminal keeps a dark background for terminal readability, but it becomes a flat `#101418` inset well with a 1px black border (not a navy block) and its text colors are checked (≥ 7:1 body, ≥ 4.5:1 dim).

**Top bar → menu bar.** Replace the floating pill with a full-width 28px menu bar: 1px black bottom rule, white background. Left: logo, **My HQ** (bold), project name, demo chip. Right: plain-text menu titles (not buttons): *Action items · Boards · PRs · Terminal · Settings*; selected title is inverted (ink bg, white text) like an open Mac menu. Setup moves to the left as an alert badge only when issues exist. Speed/zoom/plan-wall/debug collapse into a **View** and a **Dev** menu (dev menu only when `hasDev`). Sandbox status stays as a compact `● 3 running` item with a flat dot. Net: 12 controls → 6 titles + 2 menus; no select in the bar.

**Team panel → "Team" window.** One window (not N floating cards) docked left: title bar "Team · N", list of rows divided by 1px rules. A row: 32px portrait, name (bold 14), role (ink-2 12), state chip, task line (13, single line). CLI/model/local/"for you"/"blocked" chips move to the agent drawer or a row hover; only `needs-input`, `for you` and `blocked` stay (max 2 chips per row). Needs-input row: inverted (select bg, white text) *plus* the chip, so it is not color-only. Selected row: `--color-select` background, white text. Delete the outside `▶`.

**Activity feed → "Activity" window.** Same light window as everything else (kill `panel-dark`, A1). Rows: 13px Inter, line-height 1.4, 1px rule between rows. Icons become 3 colors max: ink for neutral, `mark` red for needs-input/changes, `mark` green for passed/merged. Timestamps `ink-2`. Drop the dashed 15%-alpha dividers.

**Settings and Setup.** Remove all `border-[3px] border-ink` (G1/S1) in favor of the new `.window`/`.group` (a 1px black group box with a title breaking the top line, like Mac OS group boxes). Settings modal = a Window with title bar; tabs = real tabs. Hints: 12px `ink-2`. Where a toggle/checkbox is used, on = black check inside the box (not color only).

### Phase 4 (CMU-T04): Campus and labels

Files: `src/office/engine/palette.ts`, `src/office/engine/font.ts`, `src/office/draw/*.ts`, `src/office/OfficeScene.ts` (camera), `src/theme/tokens.ts` (agent/section colors), `src/index.css` (`body` background).

- **Greenery.** Desaturate the lawn and planting: `grass #8dbb78 → #a9bf9a`, `grassD → #9ab38b`, `grassL → #b7cba9`; hedge `#4f8f5c → #6b8f74`; leaf `#5fa56a → #7a9e7f`. Target HSL saturation ≤ 25% for all large areas. Keep the sage family; this is "calm campus", not game meadow. Remove the seam (C3): the body backdrop is `--color-desk`, and the canvas clear color equals the lawn edge color, or the camera is clamped so the edge is never visible.
- **Saturated blocks.** Furniture, signs and rugs lose saturated decoration (C2): `rabbit`, `gold`, section sign colors → muted pairs (`#b4674a`, `#4d8c6e`, `#5578a8`, `#7d63a6`). Full-saturation PICO colors remain **only** for state indicators over robots (the `!` alert, status dots), where attention is the point.
- **Labels: high-contrast solid plates.** Every in-world label becomes a plate: solid `#ffffff` (or `#000` for alerts) rectangle, 1px black border, no translucency, drawn *above* sprites. Text is ink on white (21:1) or white on ink. Minimum rendered text height 8 screen px at default zoom: implement by (a) drawing labels in a **screen-space overlay layer** at a fixed pixel size (not world-scaled), using the UI face at 11–12px (the camera-scaled 3×5 font stays only for tiny decorative signage), and (b) a per-label priority so overlapping plates are culled (lead and needs-input win). Agent name tags are always shown; section signs show when zoom ≥ fit; room names show always.
- **Contrast check for plates.** Each plate/sprite/background triple is covered by the Phase 2 contrast test.
- **Robot sprites.** Keep the 12-color identity palette; remove the lightened highlight row from `shade()` use in `robots.ts` (flat two-tone: body + 1 darker side). No glow around robots; the working indicator is a small flat square.
- **Camera.** Default fit zoom must put plates at their minimum size; if the campus is too large at fit, the camera starts zoomed on the lead corner with the minimap-free pan/zoom already present, rather than shrinking labels.

### Phase 5 (CMU-T05): Personality and polish

Files: all of `src/ui/**`, `src/index.css`, small additions only.

- **Touches (pick all, keep each tiny):** (1) 50% dither pattern for disabled and "stopped" states; (2) a 1px-ruled **zoom-box** animation on drawer open/close (reduced-motion off → instant); (3) selection inversion on lists (done in P3, finalize); (4) **Happy-Mac logo**: replace the top-bar glyph with a monochrome 16×16 pixel agent face (flat, no yellow antenna); (5) a classic-style alert dialog frame for destructive confirms (`RemoveAgentDialog`): rounded 1px frame, bold default button with a double outline; (6) "Hold on…" busy states use a striped, flat progress bar; (7) the empty states get one-line Chicago-style copy (no ASCII art, no emoji).
- **Alignment pass.** Every panel, field, button on the 4px grid; radii from the Phase 2 scale only; buttons the same height in a row; label/hint pairs aligned left on a single column; consistent 16px window padding, 8px gaps in rows.
- **Final audit.** Re-run §3 against the shipped CSS, re-run the contrast test, check each drawer/settings tab on demo data, check `font-style` options (Pixel / Clean / Mono) and `prefers-reduced-motion`, and compare before/after screenshots (`docs/images/`).

## 5. Out of scope

Server code, MCP, store shape, layout algorithm (`layout.ts`), sim logic, and adding dependencies. No new bitmap font files. Dark mode is not planned (Classic Mac was light).

## 6. Reproducing the contrast numbers

```python
def lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)
def contrast(a, b):
    hi, lo = sorted([lum(a), lum(b)], reverse=True); return (hi + .05) / (lo + .05)
```

Phase 2 ships the same formula as a Vitest so the check runs in `pnpm test`.
