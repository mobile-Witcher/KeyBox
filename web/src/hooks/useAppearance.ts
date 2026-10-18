/**
 * useAppearance —— 订阅「皮肤 × 明暗」全局 store 的 React Hook。
 * 与 useTheme 并存（后者只用明暗，保持向后兼容）。
 */
import { useEffect, useState } from "react";
import {
  getSkin,
  getTheme,
  getThemePreference,
  setSkin,
  setTheme,
  setThemePreference,
  subscribeSkin,
  subscribeTheme,
  type Skin,
  type Theme,
  type ThemePreference,
} from "../lib/theme";

export function useAppearance(): {
  theme: Theme;
  /** 明暗偏好：light / dark / system（跟随系统） */
  preference: ThemePreference;
  skin: Skin;
  setTheme: (theme: Theme) => void;
  setThemePreference: (preference: ThemePreference) => void;
  setSkin: (skin: Skin) => void;
  toggleTheme: () => void;
} {
  const [theme, setLocalTheme] = useState<Theme>(() => getTheme());
  const [preference, setLocalPreference] = useState<ThemePreference>(() => getThemePreference());
  const [skin, setLocalSkin] = useState<Skin>(() => getSkin());

  useEffect(
    () =>
      subscribeTheme((nextTheme) => {
        setLocalTheme(nextTheme);
        setLocalPreference(getThemePreference());
      }),
    []
  );
  useEffect(() => subscribeSkin(setLocalSkin), []);

  return {
    theme,
    preference,
    skin,
    setTheme,
    setThemePreference,
    setSkin,
    toggleTheme: () => setTheme(getTheme() === "dark" ? "light" : "dark"),
  };
}
