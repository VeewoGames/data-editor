const chipPalette = [
  { background: "#f5d7db", color: "#7a3f4b" },
  { background: "#dbeafe", color: "#2f5f9a" },
  { background: "#f5e7b8", color: "#7a6520" },
  { background: "#e7dbfa", color: "#6d4aa2" },
  { background: "#dcefe4", color: "#2f5d49" },
  { background: "#ffe2cc", color: "#8b522b" },
];

export const namedChipPalette = {
  default: { background: "#f1f1ef", color: "#5f5e5b" },
  gray: { background: "#e9e8e5", color: "#5f5e5b" },
  brown: { background: "#efe3db", color: "#7d5847" },
  orange: { background: "#ffe2cc", color: "#8b522b" },
  yellow: { background: "#f5e7b8", color: "#7a6520" },
  green: { background: "#dcefe4", color: "#2f5d49" },
  blue: { background: "#dbeafe", color: "#2f5f9a" },
  teal: { background: "#d3eeea", color: "#2e6f67" },
  cyan: { background: "#d7eff8", color: "#2f6984" },
  lime: { background: "#e8f2cb", color: "#5d6f1f" },
  indigo: { background: "#e3e7f6", color: "#58638f" },
  slate: { background: "#566070", color: "#ffffff" },
  rose: { background: "#f8dbe7", color: "#92506b" },
  amber: { background: "#f2e2c4", color: "#7f682d" },
  purple: { background: "#e7dbfa", color: "#6d4aa2" },
  pink: { background: "#f7d8ee", color: "#8a3f74" },
  red: { background: "#ffd9d6", color: "#a13a31" },
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
