export const KeyCodes = {
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  ENTER: 13,
  SPACE: 32,
  SHIFT: 16,
  CTRL: 17,
  ALT: 18,
  BACKSPACE: 8,
  ESC: 27,
  TAB: 9,
  // Letters
  A: 65,
  B: 66,
  C: 67,
  D: 68,
  E: 69,
  F: 70,
  G: 71,
  H: 72,
  I: 73,
  J: 74,
  K: 75,
  L: 76,
  M: 77,
  N: 78,
  O: 79,
  P: 80,
  Q: 81,
  R: 82,
  S: 83,
  T: 84,
  U: 85,
  V: 86,
  W: 87,
  X: 88,
  Y: 89,
  Z: 90,
  // Number row (not valid identifiers, so prefixed)
  NUM_0: 48,
  NUM_1: 49,
  NUM_2: 50,
  NUM_3: 51,
  NUM_4: 52,
  NUM_5: 53,
  NUM_6: 54,
  NUM_7: 55,
  NUM_8: 56,
  NUM_9: 57,
} as const;

// We treat the mappings as Xbox mappings to make the constants easier to reason about
export const XBOXMappings = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4, // Called L1 in PS controllers
  RB: 5, // Called R1 in PS controllers
  LT: 6, // Called L2 in PS controllers
  RT: 7, // Called R2 in PS controllers
  BACK: 8, // Called Select in PS controllers
  START: 9,
  LSB: 10, // Left stick click, called L3 in PS controllers
  RSB: 11, // Right stick click, called R3 in PS controllers
  D_UP: 12,
  D_DOWN: 13,
  D_LEFT: 14,
  D_RIGHT: 15,
  AXES: {
    L_H: 0,
    L_V: 1,
    R_H: 2,
    R_V: 3,
  },
} as const;
