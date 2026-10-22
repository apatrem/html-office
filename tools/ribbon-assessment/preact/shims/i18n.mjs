// Replaces i18next/react-i18next: a flat dictionary holding only the keys the
// bundle references, plus i18next-style {{name}} interpolation.
import dictionary from "spike-dictionary";
export function t(key, values) {
  const text = dictionary[key] ?? key;
  return values
    ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) =>
        name in values ? String(values[name]) : m,
      )
    : text;
}
const i18n = { language: "en-US", t, init: () => Promise.resolve(t) };
export default i18n;
export const useTranslation = () => ({ t, i18n });
export const I18nextProvider = ({ children }) => children;
export const initReactI18next = { type: "3rdParty", init() {} };
