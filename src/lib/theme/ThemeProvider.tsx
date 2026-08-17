"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "prism-theme";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Theme is resolved from three places, in order of how fast they can
 * answer: the inline script in the root layout (before first paint, from
 * localStorage), this provider on mount (localStorage again, for React's
 * copy of the truth), then user_settings (authoritative, and follows the
 * operator to another machine).
 *
 * The DB read is deliberately last and non-blocking. Waiting on a network
 * round-trip before painting is what produces the white flash on a dark
 * app, and an operator opening this at night should never get flashbanged.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") setThemeState(stored);

    const supabase = createClient();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data } = await supabase
        .from("user_settings")
        .select("theme")
        .eq("user_id", userData.user.id)
        .single();

      // 'black' is a legacy value the CHECK constraint still permits from
      // the original single-file app; it has no stylesheet here, so it
      // resolves to dark rather than rendering an unstyled page.
      if (data?.theme === "light" || data?.theme === "dark") {
        setThemeState(data.theme);
        window.localStorage.setItem(THEME_STORAGE_KEY, data.theme);
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);

    const supabase = createClient();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      await supabase
        .from("user_settings")
        .upsert({ user_id: userData.user.id, theme: next }, { onConflict: "user_id" });
    })();
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
