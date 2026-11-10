// The static layer: lawn, floors, walls and furniture, drawn once per layout.

import { officeSign } from "../../data/names";
import type { HqConfig } from "../../data/types";
import { mulberry32 } from "../../lib/random";
import { soften } from "../../theme/tokens";
import { PLATE, text, textW } from "../engine/font";
import { C } from "../engine/palette";
import { box, CanvasPen, disc, ellipse, line, makeCanvas } from "../engine/pen";
import type { OfficeLayout } from "../layout/layout";
import { beanbag, easel, partitions, pavilionShell, plant, plate, rackBody, tree, workDesk } from "./furniture";

export function buildStatic(l: OfficeLayout, config: HqConfig): HTMLCanvasElement {
  const canvas = makeCanvas(l.worldW, l.worldH);
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const p = new CanvasPen(g);
  const R = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(R() * arr.length)];
  const bw = l.W * 16; // building px
  const bh = l.H * 16;

  // ------------------------------------------------ lawn, courtyard garden, paths, trees
  p.rect(0, 0, l.worldW, l.worldH, C.grass);
  for (let y = 0; y < l.worldH; y += 32) p.rect(0, y, l.worldW, 16, C.grassD, 0.35); // mown stripes
  for (let i = 0; i < (l.worldW * l.worldH) / 700; i++) {
    const x = Math.floor(R() * l.worldW);
    const y = Math.floor(R() * l.worldH);
    p.rect(x, y, 1, 2, R() < 0.5 ? C.grassD : C.grassL);
  }
  const doorY = l.oy + l.door[1] * 16;
  const cy = l.courtyard;
  // soft building shadow on the lawn
  p.rect(l.ox + bw, l.oy + 6, 5, bh, C.shadow, 0.18);
  p.rect(l.ox + 6, l.oy + bh, bw, 4, C.shadow, 0.18);
  // courtyard: stone paving, a lawn in hedges, a tree, planters and benches
  p.rect(cy.x, cy.y, cy.w, cy.h, C.stone);
  for (let y = cy.y; y < cy.y + cy.h; y += 8) p.rect(cy.x, y, cy.w, 1, C.stoneD, 0.5);
  for (let y = cy.y, r = 0; y < cy.y + cy.h; y += 8, r++) for (let x = cy.x + (r % 2) * 8; x < cy.x + cy.w; x += 16) p.rect(x, y, 1, 8, C.stoneD, 0.5);
  const gx = cy.x + 14;
  const gw = cy.w - 28;
  const gy = cy.y + 18;
  const gh = cy.h - 36;
  p.rect(gx - 3, gy - 3, gw + 6, gh + 6, C.shadow, 0.18);
  p.rect(gx, gy, gw, gh, C.grassL);
  for (let y = gy; y < gy + gh; y += 12) p.rect(gx, y, gw, 6, C.grass, 0.5);
  hedge(p, gx - 6, gy - 6, gw + 12, 7);
  hedge(p, gx - 6, gy + gh - 1, gw + 12, 7);
  hedge(p, gx - 6, gy - 6, 7, gh + 12);
  hedge(p, gx + gw - 1, gy - 6, 7, gh + 12);
  tree(p, gx + gw / 2, gy + gh / 2 - 6, 13);
  for (let y = gy + 20; y < gy + gh - 12; y += 52) if (Math.abs(y - (doorY - 8)) > 24) {
    planter(p, gx + 10, y);
    planter(p, gx + gw - 10, y);
  }
  // stone path from the entrance door out across the courtyard to the campus edge
  p.rect(cy.x - 16, doorY - 4, l.ox - cy.x + 16, 24, C.path);
  p.rect(cy.x - 16, doorY - 4, l.ox - cy.x + 16, 1, C.pathD);
  p.rect(cy.x - 16, doorY + 19, l.ox - cy.x + 16, 1, C.pathD);
  for (let x = cy.x - 16 + 12; x < l.ox; x += 24) p.rect(x, doorY - 3, 1, 22, C.pathD, 0.7);
  // stone path along the front of the building, from the courtyard past each pavilion's doorway
  if (l.pavilions.length) {
    const pathY = l.oy + bh + 14;
    const left = cy.x + cy.w / 2 - 8;
    const right = Math.max(...l.pavilions.map((q) => q.doorway.x + q.doorway.w));
    p.rect(left, pathY, right - left + 8, 20, C.path);
    p.rect(left, pathY, right - left + 8, 1, C.pathD);
    p.rect(left, pathY + 19, right - left + 8, 1, C.pathD);
    p.rect(left, cy.y + cy.h - 8, 20, pathY - (cy.y + cy.h - 8) + 20, C.path); // from the courtyard down to the path
    for (let x = left + 12; x < right + 8; x += 24) p.rect(x, pathY + 1, 1, 18, C.pathD, 0.7);
    for (const q of l.pavilions) {
      const top = pathY + 20;
      p.rect(q.doorway.x + 4, top, q.doorway.w - 8, q.rect.y + 48 - top, C.path); // stub to the doorway
    }
  }
  // trees around the edges of the campus
  const bush = (x: number, y: number) => hedge(p, x, y, 22, 9);
  for (let x = 28; x < l.worldW - 10; x += 78 + Math.floor(R() * 40)) {
    tree(p, x, 14 + Math.floor(R() * 5), 12 + Math.floor(R() * 3));
    if (x > cy.x + cy.w) tree(p, x + 20, l.worldH - 20 + Math.floor(R() * 5), 12 + Math.floor(R() * 3));
  }
  for (let y = 70; y < l.worldH - 40; y += 90 + Math.floor(R() * 40)) tree(p, l.worldW - 20 + Math.floor(R() * 4), y + 20, 13);
  if (!l.pavilions.length) for (let x = l.ox + 24; x < l.ox + bw - 40; x += 120) bush(x, l.oy + bh + 12);

  g.save();
  g.translate(l.ox, l.oy);
  const mainPx = (l.mainW + 1) * 16;
  const L = l.lounge.x0 * 16;

  // ------------------------------------------------ floors
  g.save();
  g.beginPath();
  g.rect(16, 64, mainPx - 16, bh - 80);
  g.clip();
  p.rect(16, 64, mainPx - 16, bh - 80, C.wood);
  for (let j = 0; j * 8 < bh; j++) {
    const y = 64 + j * 8;
    const off = (j % 3) * 16;
    p.rect(16, y, mainPx, 1, C.woodD);
    for (let x = 16 - off; x < mainPx; x += 48) {
      p.rect(x + 1, y + 1, 47, 7, pick([C.wood, "#d6c6aa", "#e2d4ba", C.wood]));
      p.rect(x, y, 1, 8, C.woodLine);
      if (R() < 0.12) p.rect(x + 10 + Math.floor(R() * 28), y + 3, 2, 1, C.woodLine);
    }
  }
  g.restore();

  // corridors between the sections of the AI agents room: tiled lanes with a dashed centre line
  for (const c of l.corridors) {
    const cx = c.x0 * 16;
    const top = 13 * 16;
    const bottom = (l.H - 2) * 16 - 16;
    for (let ty = top; ty < bottom; ty += 8) for (let tx = 0; tx < c.w * 2; tx++) p.rect(cx + tx * 8, ty, 8, 8, (tx + ty / 8) % 2 ? C.tileD : C.tileL);
    for (let ty = top + 4; ty < bottom; ty += 12) p.rect(cx + c.w * 8 - 1, ty, 2, 6, C.metalD);
  }
  // section signs: each CLI's own part of the room, local models in theirs
  for (const s of l.sections) {
    const w = s.w * 16 - 6;
    const accent = soften(s.color, 0.35);
    p.rect(s.x0 * 16 + 2, 14 * 16 - 20, w, 3, accent);
    const cx = s.x0 * 16 + 2 + w / 2;
    box(p, Math.round(cx - textW(s.label) / 2) - 5, 14 * 16 - 33, textW(s.label) + 10, 12, PLATE.fill, PLATE.line);
    text(p, s.label, Math.round(cx - textW(s.label) / 2), 14 * 16 - 30, PLATE.ink);
  }

  // lead carpet
  p.rect(176, 64, 144, 96, C.carpetJ);
  p.rect(179, 67, 138, 90, C.carpetJD);
  p.rect(181, 69, 134, 86, C.carpetJ);
  for (let y = 72; y < 154; y += 6) for (let x = 184 + (y % 12 ? 3 : 0); x < 314; x += 6) p.rect(x, y, 1, 1, C.carpetJD);
  // desk carpets
  for (const d of l.desks) {
    const x = (d.x0 + 1) * 16;
    const y = (d.y0 + 1) * 16;
    p.rect(x, y, 80, 96, d.carpet[0]);
    for (let yy = y + 2; yy < y + 94; yy += 4) for (let xx = x + (yy % 8 ? 2 : 0); xx < x + 80; xx += 4) p.rect(xx, yy, 1, 1, d.carpet[1]);
  }
  // lounge tiles + rug
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx * 8 < mainPx - L; tx++) p.rect(L + tx * 8, 64 + ty * 8, 8, 8, (tx + ty) % 2 ? C.tileD : C.tileL);
  p.rect(L + 16, 112, 96, 80, C.rugPD);
  p.rect(L + 18, 114, 92, 76, C.rugP);
  for (let x = L + 20; x < L + 110; x += 4) p.rect(x, 116, 2, 72, "#836399");
  // stand-up rug
  ellipse(p, 88, 150, 42, 28, C.rugGD);
  ellipse(p, 88, 150, 39, 25, C.rugG);
  ellipse(p, 88, 150, 30, 18, C.rugGD);
  ellipse(p, 88, 150, 28, 16, C.rugG);

  // server room floor
  const sr = l.serverRoom;
  if (sr) {
    const sx = sr.x0 * 16;
    const sw = sr.w * 16;
    p.rect(sx, 64, sw, bh - 80, C.grate);
    for (let y = 64; y < bh - 16; y += 8) p.rect(sx, y, sw, 1, C.grateD);
    for (let x = sx; x < sx + sw; x += 8) p.rect(x, 64, 1, bh - 80, C.grateD);
  }

  // cable channels
  for (const cb of l.cables) {
    const color = config.team.find((a) => a.id === cb.agentId)?.color ?? C.blue;
    for (let i = 0; i < cb.pts.length - 1; i++) {
      const [x0, y0] = cb.pts[i];
      const [x1, y1] = cb.pts[i + 1];
      const ax = Math.min(x0, x1) - l.ox;
      const ay = Math.min(y0, y1) - l.oy;
      p.rect(ax - 1, ay - 1, Math.abs(x1 - x0) + 3, Math.abs(y1 - y0) + 3, "#2a2230");
      p.rect(ax, ay, Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1, color, 0.55);
    }
  }

  // ------------------------------------------------ walls
  p.rect(0, 0, bw, 16, C.wallTop);
  p.rect(0, 15, bw, 1, C.wallTopL);
  p.rect(0, 16, mainPx, 48, C.wall);
  for (let y = 18; y < 44; y += 4) for (let x = y % 8 ? 2 : 0; x < mainPx; x += 4) p.rect(x, y, 1, 1, C.wallL);
  p.rect(0, 44, mainPx, 1, "#ffffff");
  p.rect(0, 45, mainPx, 15, C.wallD);
  for (let x = 8; x < mainPx; x += 16) p.rect(x, 47, 1, 11, "#d6d2c9");
  p.rect(0, 60, bw, 4, C.base);
  p.rect(0, 60, bw, 1, "#d4cfc4");
  if (sr) {
    const sx0 = sr.glassX * 16;
    p.rect(sx0, 16, bw - sx0, 44, C.wallSrv);
    for (let x = sx0; x < bw; x += 8) p.rect(x, 16, 1, 44, C.wallSrvD);
    const label = "SERVER ROOM";
    box(p, sr.x0 * 16 + (sr.w * 16) / 2 - textW(label) / 2 - 3, 3, textW(label) + 6, 9, C.ink);
    text(p, label, sr.x0 * 16 + (sr.w * 16) / 2 - textW(label) / 2, 5, C.white);
  }
  p.rect(0, 16, bw, 2, "#000000", 0.2);
  p.rect(0, 0, 16, bh, C.wallTop);
  p.rect(15, 16, 1, bh - 32, C.wallTopL);
  p.rect(bw - 16, 0, 16, bh, C.wallTop);
  p.rect(bw - 16, 16, 1, bh - 32, C.wallTopL);
  p.rect(0, bh - 16, bw, 16, C.wallTop);
  p.rect(16, bh - 16, bw - 32, 1, C.wallTopL);
  p.rect(16, bh - 13, bw - 32, 9, C.glass, 0.85);
  for (let x = 16; x < bw - 16; x += 32) p.rect(x, bh - 13, 2, 9, C.metalL);
  // door (left wall)
  p.rect(0, doorY - l.oy, 16, 16, C.glass);
  p.rect(7, doorY - l.oy, 2, 16, C.metalL);
  p.rect(0, doorY - l.oy - 3, 20, 3, C.metalD);
  p.rect(0, doorY - l.oy + 16, 20, 3, C.metalD);
  // glass wall
  if (sr) {
    const gx = sr.glassX * 16;
    p.rect(gx, 64, 16, bh - 80, "#a8d8ea", 0.42);
    p.rect(gx, 64, 1, bh - 80, C.metalD);
    p.rect(gx + 15, 64, 1, bh - 80, C.metalD);
    for (let y = 64; y < bh - 16; y += 44) {
      p.rect(gx, y, 16, 2, C.metalD);
      line(p, gx + 3, y + 16, gx + 12, y + 6, "#e3f6fb");
      line(p, gx + 3, y + 22, gx + 7, y + 18, "#e3f6fb");
    }
  }

  // ------------------------------------------------ back-wall decor
  const B = { x: l.plan.board.x - l.ox, y: l.plan.board.y - l.oy, w: l.plan.board.w };
  box(p, B.x - 3, B.y - 2, B.w + 6, 46, C.deskD);
  p.rect(B.x, B.y, B.w, 40, "#f7f3ea");
  p.rect(B.x, B.y + 38, B.w, 2, "#d8d0c0");
  p.rect(B.x + 6, B.y + 41, B.w - 12, 2, C.metalD);
  p.rect(B.x + 20, B.y + 40, 6, 1, C.red);
  p.rect(B.x + 28, B.y + 40, 6, 1, C.blue);
  const heads: [string, string][] = [["TODO", C.lav], ["DOING", C.blue], ["REVIEW", C.orange], ["DONE", C.green]];
  heads.forEach(([h, col], k) => {
    const cx = B.x + k * 35;
    if (k) p.rect(cx, B.y + 2, 1, 35, "#ddd5c4");
    text(p, h, cx + (35 - textW(h)) / 2 + 1, B.y + 2, C.ink);
    p.rect(cx + 3, B.y + 8, 30, 1, col);
  });
  box(p, 208, 22, 80, 24, C.sage);
  p.rect(209, 23, 78, 1, C.sageL);
  // Office name: big letters when it fits the 80px sign, small ones when it's longer.
  const sign = officeSign(config.project.officeName);
  const ss = textW(sign, 2) <= 76 ? 2 : 1;
  text(p, sign, 249 - textW(sign, ss) / 2, ss === 2 ? 30 : 33, "#2f4a39", ss);
  text(p, sign, 248 - textW(sign, ss) / 2, ss === 2 ? 29 : 32, "#ffffff", ss);
  box(p, 180, 22, 22, 26, C.navy);
  p.rect(189, 27, 4, 9, C.white);
  p.rect(190, 26, 2, 1, C.red);
  p.rect(190, 37, 2, 2, C.orange);
  text(p, "SHIP", 184, 41, C.yellow);
  disc(p, L - 8, 36, 8, C.ink);
  disc(p, L - 8, 36, 7, C.white);
  box(p, L + 63, 19, 66, 34, C.white);
  p.rect(L + 62, 53, 68, 3, C.deskD);

  // ------------------------------------------------ lead corner
  box(p, 288, 30, 32, 44, C.deskD);
  p.rect(290, 32, 28, 40, "#e6e2d9");
  for (let s = 0; s < 3; s++) {
    const sy = 34 + s * 13;
    p.rect(290, sy + 10, 28, 2, C.deskD);
    for (let bx = 291; bx < 316; ) {
      const w = 2 + Math.floor(R() * 3);
      const h = 7 + Math.floor(R() * 3);
      p.rect(bx, sy + 10 - h, w, h, pick(BOOKS));
      bx += w + (R() < 0.2 ? 2 : 0);
    }
  }
  plant(p, 184, 78);
  if (l.lead.agentId) {
    p.rect(210, 102, 76, 3, C.shadow, 0.25);
    box(p, 208, 82, 80, 18, C.desk);
    p.rect(209, 83, 78, 1, C.woodL);
    box(p, 208, 98, 80, 7, C.deskD);
    box(p, 222, 70, 22, 15, C.bezel);
    box(p, 248, 70, 22, 15, C.bezel);
    box(p, 230, 92, 30, 4, C.metal);
    box(p, 212, 86, 6, 6, C.white);
    p.rect(213, 87, 4, 2, "#7a4a2a");
    const lead = config.team.find((a) => a.id === l.lead.agentId);
    if (lead) plate(p, lead.name.toUpperCase().slice(0, 8), 249, 99);
  }
  // stand-up corner
  plant(p, 24, 76);
  beanbag(p, 56, 136, "#c9bfae", "#b2a794");
  beanbag(p, 136, 136, "#8fb3a0", "#789d8a");
  beanbag(p, 88, 168, "#d9cfae", "#c2b78f");
  box(p, 18, 172, 13, 12, C.metal);
  p.rect(20, 174, 9, 2, C.ink);
  p.rect(21, 170, 7, 3, C.white);

  // ------------------------------------------------ lounge
  box(p, L, 54, 48, 10, C.metal);
  box(p, L, 63, 48, 14, C.desk);
  box(p, L + 18, 36, 12, 20, "#3a3640");
  p.rect(L + 19, 37, 10, 3, C.white);
  p.rect(L + 21, 44, 6, 6, "#1f1d26");
  box(p, L + 34, 57, 12, 5, C.metalD);
  box(p, L + 49, 26, 14, 50, "#e9e9ef");
  p.rect(L + 50, 44, 12, 1, C.metalD);
  p.rect(L + 52, 52, 3, 3, C.red);
  const right = mainPx - 16;
  box(p, right + 1, 48, 12, 26, C.white);
  box(p, right + 2, 36, 10, 13, "#7fd0f2");
  p.rect(L + 32, 140, 66, 3, C.shadow, 0.25);
  box(p, L + 30, 120, 68, 10, C.couchD);
  box(p, L + 32, 128, 64, 12, C.couch);
  box(p, L + 28, 122, 6, 18, C.couchD);
  box(p, L + 94, 122, 6, 18, C.couchD);
  p.rect(L + 34, 129, 60, 1, "#5aa0ae");
  box(p, L + 50, 162, 28, 9, C.desk);
  box(p, L + 57, 160, 5, 5, C.white);
  box(p, right + 1, 100, 14, 34, "#5b3a8e");
  p.rect(right + 2, 101, 12, 5, C.yellow);
  text(p, "GO", right + 4, 101, C.ink);
  box(p, right + 3, 107, 10, 9, C.ink);
  box(p, right + 2, 118, 12, 4, "#7a55b0");
  plant(p, L - 8, 76);
  plant(p, right + 8, 204, false);

  // ------------------------------------------------ desks
  for (const d of l.desks) {
    const X = d.x0 * 16;
    const Y = d.y0 * 16;
    workDesk(p, (d.x0 + 2) * 16, Y + 16, d.index);
    partitions(p, X, Y, 7);
    const name = config.team.find((a) => a.id === d.agentId)?.name.toUpperCase().slice(0, 10) ?? "";
    plate(p, name, X + 64, Y + 4);
  }

  // ------------------------------------------------ project pavilions: desks, in/out trays
  for (const pv of l.pavilions) {
    pavilionShell(p, pv.rect.x - l.ox, pv.rect.y - l.oy, pv.rect.w, pv.rect.h, pv.name, pv.planters.map((q) => ({ x: q.x - l.ox, y: q.y - l.oy })));
    for (const s of pv.stations) {
      const dx = s.desk.x - l.ox;
      const dy = s.desk.y - l.oy;
      p.rect(s.rect.x - l.ox + 4, s.rect.y - l.oy + 22, s.rect.w - 8, 50, s.color, 0.2); // a rug in the worker's colour
      workDesk(p, dx, dy, s.index);
      plate(p, s.name.toUpperCase().slice(0, 10), dx + 24, dy + 52);
      if (s.kind === "fetcher") {
        box(p, dx + 52, dy + 12, 26, 14, C.metal);
        for (let k = 0; k < 3; k++) {
          p.rect(dx + 55 + k * 7, dy + 6 + k, 8, 6, C.ink);
          p.rect(dx + 56 + k * 7, dy + 7 + k, 6, 4, C.white);
        }
      } else if (s.kind === "writer") {
        box(p, dx + 54, dy + 6, 22, 20, "#2b3a4a");
        p.rect(dx + 58, dy + 10, 14, 12, "#3fe0c4");
        text(p, "AI", dx + 61, dy + 12, C.ink);
      } else if (s.kind === "sender") {
        box(p, dx + 54, dy + 4, 22, 22, "#5f6b80");
        p.rect(dx + 57, dy + 10, 16, 5, "#1f1d26");
        p.rect(dx + 70, dy - 2, 2, 8, C.red);
        p.rect(dx + 70, dy - 2, 6, 3, C.red);
      } else {
        box(p, dx + 54, dy + 8, 20, 18, C.metal);
        disc(p, dx + 64, dy + 17, 5, C.metalD);
        disc(p, dx + 64, dy + 17, 2, C.yellow);
      }
    }
    const ib = pv.inbox;
    box(p, ib.x - l.ox, ib.y - l.oy, ib.w, ib.h, C.metal);
    text(p, "IN", ib.x - l.ox + 9, ib.y - l.oy + 7, C.ink);
    const ob = pv.outbox;
    box(p, ob.x - l.ox, ob.y - l.oy, ob.w, ob.h, "#5f6b80");
    p.rect(ob.x - l.ox + 3, ob.y - l.oy + 10, ob.w - 6, 6, "#1f1d26");
    text(p, "OUT", ob.x - l.ox + 4, ob.y - l.oy + 3, C.white);
  }

  // ------------------------------------------------ PR board, racks, mailbox
  if (l.prBoard) easel(p, l.prBoard.x - l.ox, l.prBoard.y - l.oy, l.prBoard.w, l.prBoard.h, "PULL REQS", R);
  for (const r of l.racks) rackBody(p, r.x - l.ox, r.y - l.oy, r.h, r.name);
  if (l.mailbox) {
    const m = { x: l.mailbox.x - l.ox, y: l.mailbox.y - l.oy };
    box(p, m.x, m.y, 22, 30, "#5f6b80");
    p.rect(m.x + 3, m.y + 10, 16, 6, "#1f1d26");
    text(p, "MAIN", m.x + 4, m.y + 3, C.white);
  }
  g.restore();
  return canvas;
}

const BOOKS = ["#9db8a4", "#b9c6d6", "#d9cfae", "#c9bfae", "#e0c7c0", "#a8b7a0", "#cfd6dc"];

/** A rounded, clipped hedge: dark base, lighter top edge, a few leaf flecks. */
function hedge(p: CanvasPen, x: number, y: number, w: number, h: number) {
  p.rect(x + 1, y + h, w, 2, C.shadow, 0.2);
  p.rect(x, y, w, h, C.hedgeD);
  p.rect(x + 1, y + 1, w - 2, h - 2, C.hedge);
  p.rect(x + 1, y + 1, w - 2, 1, C.hedgeL);
  for (let i = 0; i < (w * h) / 14; i++) p.rect(x + 2 + ((i * 7) % Math.max(1, w - 4)), y + 2 + ((i * 5) % Math.max(1, h - 4)), 1, 1, i % 3 ? C.hedgeL : C.hedgeD);
}

/** A white planter box with a small clipped shrub. */
function planter(p: CanvasPen, cx: number, cy: number) {
  p.rect(cx - 6, cy + 6, 14, 3, C.shadow, 0.2);
  p.rect(cx - 7, cy + 1, 14, 8, C.pot);
  p.rect(cx - 7, cy + 7, 14, 2, C.potD);
  disc(p, cx, cy - 2, 7, C.hedgeD);
  disc(p, cx - 1, cy - 3, 5, C.hedge);
  p.rect(cx - 3, cy - 6, 2, 2, C.hedgeL);
}
