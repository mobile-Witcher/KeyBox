/**
 * useTheme —— 订阅全局主题 store 的 React Hook（R24）。
 * 同屏多处使用也会保持一致（store 广播）。
 */
import { useEffect, useState } from "react";
import { getTheme, setTheme, subscribeTheme, type Theme } from "../lib/theme";

export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
} {
  const [theme, setLocal] = useState<Theme>(() => getTheme());

  useEffect(() => subscribeTheme(setLocal), []);

  return {
    theme,
    toggle: () => setTheme(getTheme() === "dark" ? "light" : "dark"),
    setTheme,
  };
}
