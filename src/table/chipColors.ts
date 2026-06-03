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
  purple: { background: "#e7dbfa", color: "#6d4aa2" },
  pink: { background: "#f5d7db", color: "#7a3f4b" },
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
