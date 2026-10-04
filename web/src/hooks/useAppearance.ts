/**
 * useAppearance —— 订阅「皮肤 × 明暗」全局 store 的 React Hook。
 * 与 useTheme 并存（后者只用明暗，保持向后兼容）。
 */
import { useEffect, useState } from "react";
import {
  getSkin,
  getTheme,
  setSkin,
  setTheme,
  subscribeSkin,
  subscribeTheme,
  type Skin,
  type Theme,
} from "../lib/theme";

export function useAppearance(): {
  theme: Theme;
  skin: Skin;
  setTheme: (theme: Theme) => void;
  setSkin: (skin: Skin) => void;
  toggleTheme: () => void;
} {
  const [theme, setLocalTheme] = useState<Theme>(() => getTheme());
  const [skin, setLocalSkin] = useState<Skin>(() => getSkin());

  useEffect(() => subscribeTheme(setLocalTheme), []);
  useEffect(() => subscribeSkin(setLocalSkin), []);

  return {
    theme,
    skin,
    setTheme,
    setSkin,
    toggleTheme: () => setTheme(getTheme() === "dark" ? "light" : "dark"),
  };
}
