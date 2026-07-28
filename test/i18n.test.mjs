import test from "node:test";
import assert from "node:assert/strict";
import {
  interpolate,
  normalizeLocale,
  resolveLocale,
  selectLocalizedText,
  translateMessage,
  translateUiText
} from "../public/i18n-core.js";

test("normalizes supported locale tags", () => {
  assert.equal(normalizeLocale("ja-JP"), "ja");
  assert.equal(normalizeLocale("EN-us"), "en");
  assert.equal(normalizeLocale("fr-FR"), null);
});

test("saved locale wins, then browser locale, with English as the global default", () => {
  assert.equal(resolveLocale({ savedLocale: "en", languages: ["ja-JP"] }), "en");
  assert.equal(resolveLocale({ savedLocale: "invalid", languages: ["ja-JP"] }), "ja");
  assert.equal(resolveLocale({ languages: ["fr-FR"], language: "fr" }), "en");
});

test("localized text safely falls back and interpolates known values", () => {
  assert.equal(selectLocalizedText("en", "こんにちは {name}", "Hello {name}", { name: "Ada" }), "Hello Ada");
  assert.equal(selectLocalizedText("ja", null, "Fallback"), "Fallback");
  assert.equal(interpolate("Hello {name} {missing}", { name: "Ada" }), "Hello Ada {missing}");
});

test("API messages remain unchanged in Japanese", () => {
  const message = "Data Agent resource nameの形式が正しくありません。";
  assert.equal(translateMessage(message, "ja"), message);
});

test("translates exact and dynamic API messages in English", () => {
  assert.equal(
    translateMessage("Data Agent resource nameの形式が正しくありません。", "en"),
    "The Data Agent resource name is invalid."
  );
  assert.equal(
    translateMessage("未登録のData Agent IDがあります: agent_a, agent_b", "en"),
    "Unregistered Data Agent IDs: agent_a, agent_b"
  );
  assert.equal(
    translateMessage("12行目: thinking_modeはFASTまたはTHINKINGです。", "en"),
    "Row 12: thinking_mode must be FAST or THINKING."
  );
});

test("unknown API messages pass through safely", () => {
  assert.equal(translateMessage("A provider-specific error", "en"), "A provider-specific error");
  assert.equal(translateMessage(null, "en"), null);
});

test("legacy app-owned UI copy translates in both directions", () => {
  assert.equal(translateUiText("設定", "en"), "Settings");
  assert.equal(translateUiText("Settings", "ja"), "設定");
  assert.equal(
    translateUiText("  5 / 8 ケース完了  ", "en"),
    "  5 / 8 cases completed  "
  );
  assert.equal(
    translateUiText("5 / 8 cases completed", "ja"),
    "5 / 8 ケース完了"
  );
});

test("legacy UI translator preserves arbitrary user and trace content", () => {
  const userPrompt = "2026年6月の求人応募数は65,200件ですか？";
  const trace = "SELECT prefecture, COUNT(*) FROM applications";
  assert.equal(translateUiText(userPrompt, "en"), userPrompt);
  assert.equal(translateUiText(trace, "en"), trace);
});
