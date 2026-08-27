import { useEffect, useState, useCallback } from "react";
import { getLocale, type Locale } from "../store/locale";
import ko from "../locales/ko.json";
import en from "../locales/en.json";

const TRANSLATIONS: Record<Locale, typeof ko> = { ko, en };

export function useLocale() {
  const [locale, setLocale] = useState<Locale>(getLocale());

  useEffect(() => {
    function onLocaleChanged() { setLocale(getLocale()); }
    window.addEventListener("localeChanged", onLocaleChanged);
    return () => window.removeEventListener("localeChanged", onLocaleChanged);
  }, []);

  const t = useCallback(
    (path: string): string => {
      const keys = path.split(".");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let node: any = TRANSLATIONS[locale];
      for (const k of keys) {
        if (node == null) return path;
        node = node[k];
      }
      return typeof node === "string" ? node : path;
    },
    [locale],
  );

  return { locale, t };
}
