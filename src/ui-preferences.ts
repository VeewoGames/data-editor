import type {
  UserAppearancePreferences,
  UserBaseFontSize,
  UserThemeId,
  UserThemeOverrides,
} from "./api/client";

export type UiTheme = UserThemeId;
export type UiPreferences = UserAppearancePreferences;

export const defaultUiTheme: UiTheme = "light";
export const defaultBaseFontSize: UserBaseFontSize = 14;
export const uiThemeStorageKey = "data-editor:ui-theme";
export const uiFontSizeStorageKey = "data-editor:ui-font-size";

export function defaultUiPreferences(): UiPreferences {
  return {
    activeThemeId: defaultUiTheme,
    baseFontSize: defaultBaseFontSize,
  };
}

export function cloneUiPreferences(value?: Partial<UiPreferences> | null): UiPreferences {
  const normalized = normalizeUiPreferences(value);
  return {
    activeThemeId: normalized.activeThemeId,
    baseFontSize: normalized.baseFontSize,
    ...(normalized.themeOverrides ? {
      themeOverrides: {
        ...(normalized.themeOverrides.light ? { light: { ...normalized.themeOverrides.light } } : {}),
        ...(normalized.themeOverrides.dark ? { dark: { ...normalized.themeOverrides.dark } } : {}),
      },
    } : {}),
  };
}

export function normalizeUiPreferences(value?: Partial<UiPreferences> | null): UiPreferences {
  const fallback = defaultUiPreferences();
  const activeThemeId = normalizeUiTheme(value?.activeThemeId ?? undefined) ?? fallback.activeThemeId;
  const baseFontSize = normalizeBaseFontSize(value?.baseFontSize ?? undefined) ?? fallback.baseFontSize;
  const themeOverrides = normalizeThemeOverrides(value?.themeOverrides);
  return {
    activeThemeId,
    baseFontSize,
    ...(themeOverrides ? { themeOverrides } : {}),
  };
}

export function readLocalUiPreferences(storage: Pick<Storage, "getItem">): UiPreferences {
  return normalizeUiPreferences({
    activeThemeId: (storage.getItem(uiThemeStorageKey) ?? undefined) as UiTheme | undefined,
    baseFontSize: Number(storage.getItem(uiFontSizeStorageKey)) as UiPreferences["baseFontSize"],
  });
}

export function writeLocalUiPreferences(storage: Pick<Storage, "setItem" | "removeItem">, value?: Partial<UiPreferences> | null) {
  const normalized = normalizeUiPreferences(value);
  storage.setItem(uiThemeStorageKey, normalized.activeThemeId);
  storage.setItem(uiFontSizeStorageKey, String(normalized.baseFontSize));
}

function normalizeUiTheme(value: unknown): UiTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

function normalizeBaseFontSize(value: unknown): UiPreferences["baseFontSize"] | null {
  return value === 14 || value === 14.5 || value === 15 || value === 16 ? value : null;
}

function normalizeThemeOverrides(value: unknown): UserThemeOverrides | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const overrides = value as UserThemeOverrides;
  const light = normalizeThemeTokenValues(overrides.light);
  const dark = normalizeThemeTokenValues(overrides.dark);
  if (!light && !dark) return undefined;
  return {
    ...(light ? { light } : {}),
    ...(dark ? { dark } : {}),
  };
}

function normalizeThemeTokenValues(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([key, item]) => key.trim() && typeof item === "string" && item.trim());
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, item]) => [key.trim(), item.trim()]));
}
