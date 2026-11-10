// Office palette: calm corporate campus (white and warm gray surfaces, glass, soft greens).
// Agent and status colours still come from theme/tokens so robots stay readable.

import { colors } from "../../theme/tokens";

export const C = {
  ink: "#3b403c",
  grass: "#a9bf9a", grassD: "#9ab38b", grassL: "#b7cba9",
  path: "#dcd8ce", pathD: "#c6c1b5",
  wood: "#d9ceb9", woodD: "#cbc0aa", woodL: "#e6ded0", woodLine: "#bfb094",
  wall: "#f3f1ec", wallD: "#e4e1da", wallL: "#fafaf8", wallTop: "#cfcbc2", wallTopL: "#e8e5de", base: "#bdb8ad",
  wallSrv: "#5a666e", wallSrvD: "#4c575e",
  carpetJ: "#d3ddd0", carpetJD: "#c4d0c1",
  rugG: "#b5c9ad", rugGD: "#98b88f", rugP: "#e0dcd2", rugPD: "#d1ccc0",
  tileL: "#f1efea", tileD: "#e2dfd8",
  grate: "#6a6e72", grateD: "#575b5f", grateL: "#7b8085",
  part: "#d3e2e7", partD: "#b0c5cc", partCap: "#f4f7f8",
  desk: "#ece8e0", deskD: "#d3cdc0", deskDD: "#8d887d",
  metal: "#c9cacd", metalL: "#e9e8ec", metalD: "#92909a", metalDD: "#63606a",
  screen: "#17233a", bezel: "#454a5c",
  leaf: "#7a9e7f", leafD: "#668a6c", leafL: "#9bb99d", pot: "#e8e4dc", potD: "#cfc9bd",
  belt: "#4a4a52", beltL: "#66666e", rail: "#a9a6b0",
  cork: "#c4a888", corkD: "#a38a6d",
  sky: "#b5d3e6", skyN: "#1d2b53", cloud: "#ffffff",
  couch: "#8a9e92", couchD: "#74887c",
  red: colors.red, orange: colors.orange, yellow: colors.yellow, green: colors.green, blue: colors.blue, lav: colors.lav,
  pink: colors.pink, peach: "#f0d4c0", white: colors.white, navy: colors.navy,
  rabbit: "#cf8a5c", gold: "#d9bb62",
  shadow: "#2f3a33",
  // campus extras
  stone: "#d8d4ca", stoneD: "#c2bdb0", hedge: "#6b8f74", hedgeD: "#587d61", hedgeL: "#82a28a",
  glass: "#d3e3e8", glassD: "#b0c8d0", sage: "#4d6b57", sageL: "#6f8e78",
} as const;

/** Floor carpet colours for desks, cycled by desk index. */
export const deskCarpets: [string, string][] = [
  ["#cfdad3", "#c1cec6"],
  ["#ddd8c8", "#cfc9b7"],
  ["#c9d6c3", "#bbc9b4"],
  ["#d4d8de", "#c6cbd3"],
  ["#dcd2c6", "#cec3b5"],
  ["#c8d8d6", "#bacbc9"],
];
