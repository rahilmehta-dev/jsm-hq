# UI design brief (for approval)

Answers the problems in [ui-critique.md](ui-critique.md). Direction: calm, grayscale Classic-Mac-inspired chrome, a quiet sage campus, and **names you can read without zooming**. Original work: no Apple logo, fonts, icons or artwork. Nothing is built until this is approved.

## 1. Palette (named tokens; ratios computed with the WCAG 2.x formula)

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `paper` | #ffffff | windows, plates | ink 21:1 |
| `platinum` | #dddddd | title bars, sub-headers | ink-2 6.2:1 |
| `platinum-2` | #c8c8c8 | pressed/inset | ink-2 5.1:1 |
| `desk` | #a8a8a8 | app backdrop (fixes the white strip) | ink 8.8:1 |
| `ink` | #000000 | text, 1px borders | – |
| `ink-2` | #4d4d4d | secondary text (never below 12px) | 8.5:1 on paper |
| `select` | #3a5a8c | selection, focus ring, links | 6.95:1 vs white either way |
| `warn-fill` / `bad-fill` / `ok-fill` | #f5e2b8 / #f6cfcf / #cfe9d5 | chips, notices (ink text) | 16.5 / 14.7 / 16.3:1 |
| `mark-*` (dots/icons only) | #1b6ca8 #946000 #b3261e #1d7a3a #5c5c5c | state dots | ≥ 4.2:1 on fills, ≥ 5.3:1 on paper |
| `well` | #101418 | terminal inset (replaces navy) | text #e8e8e8 15.1, dim #a9b0b8 8.5, error #f6cfcf 13:1 |
| `lawn` / `lawn-d` | #a9bf9a / #9ab38b | campus ground (saturation ≤ 25%) | plates on it: ink 10.6:1 |

Rules: no orange, purple or yellow blocks; saturated color appears only as agent identity (small robots, 2px plate swatch) and 7px state dots. Never state color as text on light surfaces. Contrast is enforced by `src/theme/contrast.test.ts`, which this phase extends to the new tokens.

## 2. Type scale and fonts

UI: **Inter** (SIL OFL 1.1). Code, terminals, ids: **JetBrains Mono** (OFL 1.1). Optional "Pixel" style stays: **Pixelify Sans** (OFL 1.1), **VT323** (OFL 1.1). All are bundled via @fontsource and redistributable with the license kept. No system or Apple fonts are referenced.

| Step | Size / line | Use |
|---|---|---|
| `xs` | 12 / 16 | hints, timestamps (floor; ink-2 on paper only) |
| `sm` | 13 / 18 | rows, chips, menu bar |
| `base` | 14 / 20 | body, form fields |
| `lg` | 17 / 24 | window and section headings |
| `label` | 12 bold / 16 | **campus plates** (new, screen space) |

## 3. Spacing, corners, borders

- 4px grid; allowed gaps/paddings 4 · 8 · 12 · 16 · 24. Buttons 24px min height (28px primary), hit target ≥ 24px.
- Corners: windows 2px, controls 4px, chips 2px. No pills, no blur.
- Borders: 1px ink everywhere; one shadow `2px 2px 0 #000`. Dividers 1px ink.
- Focus: 2px `select` outline, 2px offset. Disabled: ink-2 text on platinum (never opacity alone).

## 4. Windows and title bars

22px bar: pinstripes (1px ink lines, 3px pitch) on platinum, **close box left** (14px, white, 1px ink), centered bold title on a platinum plate that breaks the stripes, zoom box right. Menu bar: 28px, white, plain-text items, inverted when pressed. Modals (Boards, Settings, dialogs) dim the whole page **including the menu bar** (backdrop above it, `ink` at 35%). Group boxes: 1px solid ink with a title breaking the top rule. Alert: double rule frame; the safe action is the default button (double outline).

## 5. Labels on the campus

- Solid `paper` plate, 1px ink outline, `ink` text (21:1). Never translucent, never colored fill; identity is a 2px swatch.
- **Screen-space overlay**: plates are drawn in the DOM/canvas overlay at a fixed 12px Inter bold, not scaled with the camera, so they stay readable at any zoom. Anchored above each agent / room / sign, 4px padding.
- Priority and culling: lead and needs-input first, then names, then room signs; overlapping plates hide the lowest priority; hover reveals all. Room signs show at fit zoom and above; names always.
- **Framing**: the camera fits the campus to the free area and keeps that scale when a drawer opens (the map slides under the drawer, never shrinks).

## 6. Before / after sketches

**A. Whole office** — before: tiny campus floating in a large lawn, 5px names, white strip at the bottom.
```
BEFORE                         AFTER
[bar]                          [bar]
|Team|   . . small map . .     |Team|  [MICHAEL]  [DWIGHT]  [JIM]
|Act.|   (names ~5px)          |Act.|  campus fills free area,
 ______ white strip ______     (desk-gray fills to the edge)
```
**B. Top bar** — before: 13 controls, "Plan wall" wraps. After: `My HQ · Demo data | Project … | Action items · Boards · PRs · Terminal · Settings · View ▾`; speed, zoom, plan wall, Debug move into **View ▾** (Debug only with dev tools).

**C. Team row** — before: chips clipped (`3 bloc`). After: row = portrait · name+role · one state chip · time; "for you / blocked" as one trailing count chip `2 ⚑` with a tooltip; text wraps, never clips.
```
[▣] Dwight  Developer        10s        [▣] Dwight  Developer   10s
    [Working] [1 for you][3 bloc        [Working]            [4 waiting]
```
**D. Agent drawer** — before: navy terminal block, 11–12px notes. After: `well` terminal inset with 1px border inside a platinum window; status line and tabs on platinum; tabs are real tabs (selected joins the pane).

**E. Settings** — before: heavy bevelled nav buttons, dotted group borders. After: left list of plain rows (selected = inverted), right pane of 1px group boxes with titles breaking the rule; fields in a 2-column grid on the 4px grid.

**F. Modal / alert** — before: weak dim, menu bar above. After: full-page dim, window centered with title bar, alert uses double frame and `[Cancel]` as the default button.

## 7. Out of scope / decisions needed

Approve or change: (1) Happy-Mac-style top-bar face vs a neutral glyph; (2) screen-space plates in Inter bold 12px vs keeping the bitmap font enlarged; (3) moving Debug/zoom/speed under **View ▾**. Build phases afterwards: tokens + test → chrome fixes → label overlay + camera → Settings/Setup/modals.
