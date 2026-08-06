import {
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveLocale,
  selectLocalizedText,
  translateMessage,
  translateUiText
} from "./i18n-core.js";

export { SUPPORTED_LOCALES, translateUiText };

const STORAGE_KEY = "prismtrail-locale";
const PAGE_COPY = {
  ja: {
    title: "PrismTrail — データエージェント評価",
    description: "データエージェントの回帰テスト、精度評価、実行トレース、レポーティングをローカルで管理します。"
  },
  en: {
    title: "PrismTrail — Data Agent Evaluation",
    description: "Run and manage data-agent regression tests, business requirement evaluations, execution traces, and reports locally."
  }
};
let activeLocale = null;

function readSavedLocale() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function browserLanguages() {
  const navigatorValue = globalThis.navigator;
  return {
    languages: Array.isArray(navigatorValue?.languages) ? navigatorValue.languages : [],
    language: navigatorValue?.language || ""
  };
}

export function getLocale() {
  if (!activeLocale) {
    activeLocale = resolveLocale({ savedLocale: readSavedLocale(), ...browserLanguages() });
  }
  return activeLocale;
}

export function tr(ja, en, vars = {}) {
  return selectLocalizedText(getLocale(), ja, en, vars);
}

export function formatLocaleDate(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat(getLocale() === "ja" ? "ja-JP" : "en-US", options).format(date);
}

export function formatLocaleNumber(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return new Intl.NumberFormat(getLocale() === "ja" ? "ja-JP" : "en-US", options).format(number);
}

export function translateApiMessage(message) {
  return translateMessage(message, getLocale());
}

export function localizeDocument(root) {
  const documentValue = globalThis.document;
  if (!documentValue) return getLocale();

  const locale = getLocale();
  const copy = PAGE_COPY[locale];
  const scope = root?.querySelectorAll ? root : documentValue;
  documentValue.documentElement.lang = locale;
  documentValue.title = copy.title;

  const description = documentValue.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", copy.description);

  for (const element of scope.querySelectorAll("[data-i18n-ja][data-i18n-en]")) {
    element.textContent = element.dataset[`i18n${locale === "ja" ? "Ja" : "En"}`] || "";
  }

  for (const attribute of ["placeholder", "title", "aria-label"]) {
    const suffix = attribute === "aria-label" ? "AriaLabel" : `${attribute[0].toUpperCase()}${attribute.slice(1)}`;
    for (const element of scope.querySelectorAll(`[data-i18n-${attribute}-ja][data-i18n-${attribute}-en]`)) {
      element.setAttribute(attribute, element.dataset[`i18n${suffix}${locale === "ja" ? "Ja" : "En"}`] || "");
    }
  }

  const walker = documentValue.createTreeWalker(scope, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, pre, code, textarea, .chat p, .trace-event p")) continue;
    node.nodeValue = translateUiText(node.nodeValue, locale);
  }

  for (const element of scope.querySelectorAll("[placeholder], [title], [aria-label]")) {
    for (const attribute of ["placeholder", "title", "aria-label"]) {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, translateUiText(element.getAttribute(attribute), locale));
      }
    }
  }
  for (const element of scope.querySelectorAll('input[type="button"], input[type="submit"], input[type="reset"]')) {
    element.value = translateUiText(element.value, locale);
  }
  return locale;
}

export function setLocale(locale) {
  const nextLocale = normalizeLocale(locale) || "en";
  activeLocale = nextLocale;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, nextLocale);
  } catch {
    // The app still switches language when storage is unavailable.
  }
  localizeDocument();
  globalThis.dispatchEvent?.(new CustomEvent("prismtrail:localechange", {
    detail: { locale: nextLocale }
  }));
  return nextLocale;
}

if (globalThis.document) localizeDocument();
