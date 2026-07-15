import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import cs from "./cs.json";
import en from "./en.json";

export const namespaces = [
  "common",
  "chat",
  "characters",
  "personas",
  "lorebooks",
  "memory",
  "settings",
] as const;

export const supportedLanguages = ["cs", "en"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

void i18n.use(initReactI18next).init({
  resources: { cs, en },
  ns: namespaces,
  defaultNS: "common",
  lng: "cs",
  fallbackLng: "cs",
  interpolation: { escapeValue: false },
});

export default i18n;
