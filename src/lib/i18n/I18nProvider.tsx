"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { translate, type Language } from "./translations";

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType>({
  language: "en",
  setLanguage: () => {},
  t: (key: string) => key,
});

export function useTranslation() {
  return useContext(I18nContext);
}

/**
 * Where the chosen language lives between page loads.
 *
 * user_settings.language is still the record of truth — it follows the
 * person to another machine — but it costs an auth call plus a query, and
 * until that lands every screen renders in English and then repaints. On
 * a dashboard that is a visible flash on every navigation.
 *
 * It also cannot help /login at all: the preference is per-user and
 * nobody is signed in yet, so the sign-in screen could never be anything
 * but English no matter how completely it was translated.
 *
 * A copy in localStorage fixes both. It is read on mount, before the
 * database answers, and it is readable when signed out.
 */
const STORE_KEY = "prism.language";

const isLanguage = (v: unknown): v is Language => v === "en" || v === "fr" || v === "ar";

/** Storage throws outright in some privacy modes rather than returning
 *  null, and a language preference is never worth breaking a page over. */
function readStored(): Language | null {
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    return isLanguage(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(lang: Language) {
  try {
    window.localStorage.setItem(STORE_KEY, lang);
  } catch {
    /* ignore — the database copy is the one that matters */
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Always "en" for the first render. Reading storage in the initialiser
  // would make the server and client disagree and fail hydration, so the
  // read happens in the effect below instead — one frame later, rather
  // than one round trip later.
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const stored = readStored();
    if (stored) setLanguageState(stored);

    const supabase = createClient();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data } = await supabase
        .from("user_settings")
        .select("language")
        .eq("user_id", userData.user.id)
        .single();
      // The database wins when the two disagree: the person may have
      // changed it on another machine since this browser last stored one.
      if (isLanguage(data?.language)) {
        setLanguageState(data.language);
        writeStored(data.language);
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("lang", language);
    document.documentElement.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    writeStored(lang);
    const supabase = createClient();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      await supabase
        .from("user_settings")
        .upsert({ user_id: userData.user.id, language: lang }, { onConflict: "user_id" });
    })();
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );

  return <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>;
}
