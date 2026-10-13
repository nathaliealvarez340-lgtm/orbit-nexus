"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  PRODUCT_DEFAULTS,
  type Theme,
  type Locale,
} from "@/lib/experience/catalog";
import { translate, type Namespace, messages } from "@/lib/i18n";
type Experience = {
  theme: Theme;
  locale: Locale;
  timezone: string;
  revision?: number;
};
const Context = createContext<{
  value: Experience;
  preview: (update: Partial<Experience>) => void;
}>({ value: PRODUCT_DEFAULTS, preview: () => {} });
export function ExperienceProvider({
  initial,
  children,
}: {
  initial: Experience;
  children: ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const [serverKey, setServerKey] = useState(JSON.stringify(initial));
  const nextServerKey = JSON.stringify(initial);
  if (serverKey !== nextServerKey) {
    setServerKey(nextServerKey);
    if ((initial.revision ?? 0) >= (value.revision ?? 0)) setValue(initial);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = value.theme;
    document.documentElement.lang = value.locale;
  }, [value]);
  return (
    <Context.Provider
      value={{
        value,
        preview: (update) =>
          setValue((previous) =>
            update.revision !== undefined &&
            update.revision < (previous.revision ?? 0)
              ? previous
              : {
                  theme: update.theme ?? previous.theme,
                  locale: update.locale ?? previous.locale,
                  timezone: update.timezone ?? previous.timezone,
                  revision: update.revision ?? previous.revision,
                },
          ),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useExperience() {
  const context = useContext(Context);
  return {
    ...context,
    t: <N extends Namespace>(
      namespace: N,
      key: keyof (typeof messages)[N]["es-MX"],
      params?: Record<string, string | number>,
    ) => translate(context.value.locale, namespace, key, params),
  };
}
