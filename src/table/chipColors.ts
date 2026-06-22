const chipPalette = [
  { background: "#f5d7db", color: "#7a3f4b" },
  { background: "#dbeafe", color: "#2f5f9a" },
  { background: "#f5e7b8", color: "#7a6520" },
  { background: "#e7dbfa", color: "#6d4aa2" },
  { background: "#dcefe4", color: "#2f5d49" },
  { background: "#ffe2cc", color: "#8b522b" },
];

export const namedChipPalette = {
  default: { background: "#f1f1ef", color: "#5f5e5b", swatchBorder: "#d5d3cf" },
  gray: { background: "#e9e8e5", color: "#5f5e5b", swatchBorder: "#cdcbc6" },
  brown: { background: "#efe3db", color: "#7d5847", swatchBorder: "#d7bca9" },
  orange: { background: "#ffe2cc", color: "#8b522b", swatchBorder: "#efb684" },
  yellow: { background: "#f5e7b8", color: "#7a6520", swatchBorder: "#dfc56b" },
  green: { background: "#dcefe4", color: "#2f5d49", swatchBorder: "#93c7ac" },
  blue: { background: "#dbeafe", color: "#2f5f9a", swatchBorder: "#94c0f2" },
  teal: { background: "#d3eeea", color: "#2e6f67", swatchBorder: "#6fbbaf" },
  cyan: { background: "#d7eff8", color: "#2f6984", swatchBorder: "#8dc2d8" },
  lime: { background: "#e8f2cb", color: "#5d6f1f", swatchBorder: "#c2d786" },
  indigo: { background: "#e3e7f6", color: "#58638f", swatchBorder: "#b7bfdc" },
  rose: { background: "#f8dbe7", color: "#92506b", swatchBorder: "#e1a9c0" },
  amber: { background: "#f2e2c4", color: "#7f682d", swatchBorder: "#d6bb83" },
  purple: { background: "#e7dbfa", color: "#6d4aa2", swatchBorder: "#bea7e5" },
  pink: { background: "#f7d8ee", color: "#8a3f74", swatchBorder: "#e8a8d1" },
  red: { background: "#ffd9d6", color: "#a13a31", swatchBorder: "#efaaa3" },
  mid_gray: { background: "#7c8697", color: "#ffffff", swatchBorder: "transparent" },
  mid_brown: { background: "#8e6d5b", color: "#ffffff", swatchBorder: "transparent" },
  mid_orange: { background: "#cf8554", color: "#ffffff", swatchBorder: "transparent" },
  mid_yellow: { background: "#b89a4d", color: "#ffffff", swatchBorder: "transparent" },
  mid_green: { background: "#5f9076", color: "#ffffff", swatchBorder: "transparent" },
  mid_blue: { background: "#6b95c8", color: "#ffffff", swatchBorder: "transparent" },
  mid_teal: { background: "#609d97", color: "#ffffff", swatchBorder: "transparent" },
  mid_cyan: { background: "#699daf", color: "#ffffff", swatchBorder: "transparent" },
  mid_lime: { background: "#94a85c", color: "#ffffff", swatchBorder: "transparent" },
  mid_indigo: { background: "#7a86b3", color: "#ffffff", swatchBorder: "transparent" },
  mid_purple: { background: "#9276c1", color: "#ffffff", swatchBorder: "transparent" },
  mid_pink: { background: "#b878a0", color: "#ffffff", swatchBorder: "transparent" },
  mid_red: { background: "#cc7a72", color: "#ffffff", swatchBorder: "transparent" },
  mid_rose: { background: "#be7996", color: "#ffffff", swatchBorder: "transparent" },
  mid_amber: { background: "#b3935d", color: "#ffffff", swatchBorder: "transparent" },
  dark_gray: { background: "#566070", color: "#ffffff", swatchBorder: "transparent" },
  dark_brown: { background: "#6f5445", color: "#ffffff", swatchBorder: "transparent" },
  dark_orange: { background: "#b85c1f", color: "#ffffff", swatchBorder: "transparent" },
  dark_yellow: { background: "#9a7414", color: "#ffffff", swatchBorder: "transparent" },
  dark_green: { background: "#2f6b4f", color: "#ffffff", swatchBorder: "transparent" },
  dark_blue: { background: "#2f5e9e", color: "#ffffff", swatchBorder: "transparent" },
  dark_teal: { background: "#2d6f67", color: "#ffffff", swatchBorder: "transparent" },
  dark_cyan: { background: "#2b6c7f", color: "#ffffff", swatchBorder: "transparent" },
  dark_lime: { background: "#667a1f", color: "#ffffff", swatchBorder: "transparent" },
  dark_indigo: { background: "#5a6694", color: "#ffffff", swatchBorder: "transparent" },
  dark_purple: { background: "#7450a8", color: "#ffffff", swatchBorder: "transparent" },
  dark_pink: { background: "#9b4e7f", color: "#ffffff", swatchBorder: "transparent" },
  dark_red: { background: "#b24940", color: "#ffffff", swatchBorder: "transparent" },
  dark_rose: { background: "#9d536f", color: "#ffffff", swatchBorder: "transparent" },
  dark_amber: { background: "#8f6a25", color: "#ffffff", swatchBorder: "transparent" },
} as const;

export function chipStyleForValue(value: string | number, colorName?: keyof typeof namedChipPalette | null) {
  const palette = colorName ? namedChipPalette[colorName] : chipPalette[Math.abs(hashCode(String(value))) % chipPalette.length];
  return {
    background: palette.background,
    color: palette.color,
  };
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash) + value.charCodeAt(index);
  return hash;
}
