export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "refill-tracker.theme";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
}

export function parseStoredTheme(value: string | null): AppTheme {
  return value === "dark" ? "dark" : "light";
}

export function readThemePreference(storage: ThemeStorage = window.localStorage): AppTheme {
  try {
    return parseStoredTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function applyTheme(theme: AppTheme, root: ThemeRoot = document.documentElement): void {
  root.setAttribute("data-theme", theme);
  // AG Grid 36's colorSchemeVariable watches this document-level attribute.
  root.setAttribute("data-ag-theme-mode", theme);
}

export function saveThemePreference(
  theme: AppTheme,
  storage: ThemeStorage = window.localStorage,
): boolean {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** Apply the stored preference before React renders; missing/corrupt storage is light. */
export function initializeTheme(
  storage: ThemeStorage = window.localStorage,
  root: ThemeRoot = document.documentElement,
): AppTheme {
  const theme = readThemePreference(storage);
  applyTheme(theme, root);
  return theme;
}
