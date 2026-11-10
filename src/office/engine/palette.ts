// Office palette: calm corporate campus (white and warm gray surfaces, glass, soft greens).
// Agent and status colours still come from theme/tokens so robots stay readable.

import { colors } from "../../theme/tokens";

export const C = {
  ink: "#3b403c",
  grass: "#8dbb78", grassD: "#80ae6c", grassL: "#9bc986",
  path: "#dcd8ce", pathD: "#c6c1b5",
  wood: "#dccdb2", woodD: "#cfc0a4", woodL: "#e9dec8", woodLine: "#bfb094",
  wall: "#f3f1ec", wallD: "#e4e1da", wallL: "#fbfaf8", wallTop: "#cfcbc2", wallTopL: "#e8e5de", base: "#bdb8ad",
  wallSrv: "#5a666e", wallSrvD: "#4c575e",
  carpetJ: "#d3ddd0", carpetJD: "#c4d0c1",
  rugG: "#a9c8a0", rugGD: "#98b88f", rugP: "#e0dcd2", rugPD: "#d1ccc0",
  tileL: "#f1efea", tileD: "#e2dfd8",
  grate: "#6a6e72", grateD: "#575b5f", grateL: "#7b8085",
  part: "#cfe3ea", partD: "#a9c6d1", partCap: "#f4f8fa",
  desk: "#ece8e0", deskD: "#d3cdc0", deskDD: "#8d887d",
  metal: "#c9cacd", metalL: "#e9e8ec", metalD: "#92909a", metalDD: "#63606a",
  screen: "#17233a", bezel: "#454a5c",
  leaf: "#5fa56a", leafD: "#4a8a58", leafL: "#8cc58a", pot: "#e8e4dc", potD: "#cfc9bd",
  belt: "#4a4a52", beltL: "#66666e", rail: "#a9a6b0",
  cork: "#c9a27a", corkD: "#a88259",
  sky: "#8fd3ff", skyN: "#1d2b53", cloud: "#ffffff",
  couch: "#8a9e92", couchD: "#74887c",
  red: colors.red, orange: colors.orange, yellow: colors.yellow, green: colors.green, blue: colors.blue, lav: colors.lav,
  pink: colors.pink, peach: "#ffccaa", white: colors.white, navy: colors.navy,
  rabbit: "#ff7a30", gold: "#ffcf3a",
  shadow: "#2f3a33",
  // campus extras
  stone: "#d8d4ca", stoneD: "#c2bdb0", hedge: "#4f8f5c", hedgeD: "#3f7a4c", hedgeL: "#6aab72",
  glass: "#cfe6ee", glassD: "#a9c9d4", sage: "#4d6b57", sageL: "#6f8e78",
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
