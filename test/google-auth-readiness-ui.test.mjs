import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("app loads Google auth readiness before the first route", () => {
  assert.match(app, /json\("\/api\/auth\/readiness"\)\.catch/);
  assert.match(app, /authReadiness,/);
});

test("shared shell exposes authentication status and recovery settings", () => {
  assert.match(app, /function googleAuthBanner\(\)/);
  assert.match(app, /if \(auth\.ready \|\| auth\.status === "checking"\) return ""/);
  assert.match(app, /!auth\.ready && auth\.status !== "checking"/);
  assert.doesNotMatch(app, /<div class="auth-banner">/);
  assert.match(app, /href="#\/settings\/auth"/);
  assert.match(app, /data-settings-tab="auth"/);
  assert.match(app, /data-copy-auth-command/);
  assert.match(app, /サービスアカウント鍵をSecret Managerへ保存しない/);
  assert.match(app, /auth-service-account-email/);
  assert.match(app, /replaceAll\(\s*"SERVICE_ACCOUNT_EMAIL"/);
  assert.match(app, /auth-manual-steps/);
  assert.doesNotMatch(app, /自組織のOAuthクライアントを使用/);
  assert.doesNotMatch(app, /set-quota-project/);
  assert.doesNotMatch(app, /<code>gcloud auth application-default login --scopes=/);
});

test("Google-backed mutations are guarded by capability before fetch", () => {
  const guardIndex = app.indexOf("googleAuthFeatureForRequest(url, options)");
  const fetchIndex = app.indexOf("const response = await fetch(url, options)");
  assert.ok(guardIndex >= 0 && guardIndex < fetchIndex);
  assert.match(app, /path\.startsWith\("\/api\/sheets\/"\).*return "sheets"/);
  assert.match(app, /path\.startsWith\("\/api\/gcs\/"\)/);
});

test("Sheets setup exposes a user ADC option while keeping Cloud operations separate", () => {
  assert.match(app, /option\?\.id === "user-adc"/);
  assert.match(app, /ユーザーADCでSheetsのみ利用/);
  assert.match(app, /GCS・Data Agent操作にはCloud scopeが別途必要/);
  assert.match(app, /path\.startsWith\("\/api\/sheets\/"\)/);
});
