# UI critique (demo data, after the Classic Mac restyle)

Captured with headless Chromium (1440×900) on the built-in mock (`pnpm dev`, no token). Pixel's model can read images, so no hand-off to Dwight is needed.

| View | Screenshot |
|---|---|
| Whole office | [office-demo](images/office-demo.png) |
| Top bar | [top-bar](images/top-bar.png) |
| Boards / PRs / Action items | [boards](images/drawer-boards.png) · [prs](images/drawer-prs.png) · [actions](images/drawer-actions.png) |
| Team settings | [settings-team](images/settings-team.png) |
| Agent panel | [agent-panel](images/agent-panel.png) |
| Project pavilion | [pavilion](images/pavilion.png) · [office with pavilion](images/office-with-pavilion.png) |

## What works
- Chrome is calm and consistent: black 1px frames, pinstripe title bars with close box, one hard shadow, grayscale surfaces. Windows read as windows.
- Chips are pale fills with black text and a small colored dot; state is clear without loud blocks.
- Selected/needs-input rows in the Team window are obvious ([agent-panel](images/agent-panel.png)). Drawer text is large and high-contrast.
- Campus is quiet sage and beige; the pavilion sign is a clear solid plate ([pavilion](images/pavilion.png)).

## What hurts readability
- **Campus names are tiny at default zoom** ([office-demo](images/office-demo.png)): MICHAEL, DWIGHT, JIM, CLAUDE CODE are ~5px bitmap type. With a drawer open the whole campus shrinks further ([drawer-actions](images/drawer-actions.png)) and nothing is legible. Biggest gap against "names legible without zooming".
- Team chips are **clipped** ("3 bloc…", "3 block") in the 280px panel.
- The top-bar "Plan wall" label **wraps and is cut off** at the top edge; the select is truncated ("First active (Phase :").
- Small secondary text (12px ink-2 on platinum) is the weakest contrast on screen; verify it stays ≥ 4.5:1.

## What is cluttered
- Top bar still carries ~13 controls in one row (speed, zoom, plan wall, sandbox, six menus, Debug).
- Team panel is half empty with 3 agents while Activity repeats the same events as the terminal and chips; the Activity list is truncated mid-sentence.
- Campus is small inside a large lawn: most of the screen is empty green, while the HUD takes the left third.

## What breaks the design intent
- A **white strip ~28px tall at the bottom** of every screen (the canvas does not reach the viewport bottom); the intended gray desk is not visible.
- Agent drawer terminal is a large **navy block** ([agent-panel](images/agent-panel.png)); Settings nav and tabs still use heavy bevelled buttons and dotted group borders, unlike the window frames elsewhere.
- Boards modal backdrop barely dims the page, and the top bar stays above it ([drawer-boards](images/drawer-boards.png)), so it feels like a window, not a modal.
- Setup, Welcome and several Settings tabs still carry the old 3px pixel frames (not captured; out of the demo path).

## Suggested next steps
1. Screen-space name plates at a fixed 11–12px, and fit the campus to the free area (no shrink when a drawer opens).
2. Fix the bottom strip, the wrapped "Plan wall" label and chip overflow.
3. Move Debug/zoom/speed into a View menu; restyle the terminal well to a flat dark-gray inset.
