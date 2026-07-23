import { describe, expect, it } from "vitest";
import {
  applyTheme,
  initializeTheme,
  parseStoredTheme,
  readThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY,
  type ThemeRoot,
  type ThemeStorage,
} from "../src/lib/theme";

class MemoryStorage implements ThemeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class AttributeRoot implements ThemeRoot {
  readonly attributes = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

describe("theme preference", () => {
  it("defaults missing and unrecognized values to light", () => {
    expect(parseStoredTheme(null)).toBe("light");
    expect(parseStoredTheme("")).toBe("light");
    expect(parseStoredTheme("system")).toBe("light");
    expect(parseStoredTheme("true")).toBe("light");
  });

  it("restores a saved dark preference and applies both app and AG Grid modes", () => {
    const storage = new MemoryStorage();
    const root = new AttributeRoot();
    storage.setItem(THEME_STORAGE_KEY, "dark");

    expect(initializeTheme(storage, root)).toBe("dark");
    expect(root.attributes.get("data-theme")).toBe("dark");
    expect(root.attributes.get("data-ag-theme-mode")).toBe("dark");
  });

  it("persists a dark selection and restores it on the next launch", () => {
    const storage = new MemoryStorage();
    const root = new AttributeRoot();
    const restartedRoot = new AttributeRoot();

    applyTheme("dark", root);
    expect(saveThemePreference("dark", storage)).toBe(true);

    expect(readThemePreference(storage)).toBe("dark");
    expect(root.attributes.get("data-theme")).toBe("dark");
    expect(root.attributes.get("data-ag-theme-mode")).toBe("dark");
    expect(initializeTheme(storage, restartedRoot)).toBe("dark");
    expect(restartedRoot.attributes.get("data-theme")).toBe("dark");
  });

  it("keeps the safe light default when storage is unavailable", () => {
    const unavailableStorage: ThemeStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(readThemePreference(unavailableStorage)).toBe("light");
    expect(saveThemePreference("dark", unavailableStorage)).toBe(false);
  });
});
