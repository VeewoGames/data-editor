export function sanitizeNumberDraft(input: string) {
  let result = "";
  let hasSign = false;
  let hasDecimal = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character >= "0" && character <= "9") {
      result += character;
      continue;
    }
    if (character === "-" && !hasSign && result.length === 0) {
      result += character;
      hasSign = true;
      continue;
    }
    if (character === "." && !hasDecimal) {
      if (result === "" || result === "-") result += "0";
      result += ".";
      hasDecimal = true;
    }
  }
  return result;
}

export function parseNumberDraft(input: string): number | null {
  const normalized = sanitizeNumberDraft(input).trim();
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
