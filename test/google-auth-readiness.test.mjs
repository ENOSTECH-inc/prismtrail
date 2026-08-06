import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnoseGoogleAuth,
  googleAuthSetupOptions
} from "../lib/google-auth-readiness.mjs";

const fixedNow = () => new Date("2026-08-04T00:00:00.000Z");

test("Google auth readiness reports all required capabilities", async () => {
  const result = await diagnoseGoogleAuth({
    tokenProvider: async () => ({ token: "secret", source: "adc" }),
    tokenInfoProvider: async () => ({ scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/spreadsheets"
    ] }),
    now: fixedNow
  });
  assert.equal(result.status, "ready");
  assert.equal(result.features.every((feature) => feature.granted), true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("Google auth readiness identifies a missing Sheets scope", async () => {
  const result = await diagnoseGoogleAuth({
    tokenProvider: async () => ({ token: "secret", source: "adc" }),
    tokenInfoProvider: async () => ({ scope: "https://www.googleapis.com/auth/cloud-platform" }),
    now: fixedNow
  });
  assert.equal(result.status, "limited");
  assert.equal(result.features.find((feature) => feature.id === "cloud").status, "ready");
  assert.equal(result.features.find((feature) => feature.id === "sheets").status, "missing");
  const setupOptions = googleAuthSetupOptions("my-project");
  assert.equal(setupOptions.length, 1);
  const userAdcOption = setupOptions[0];
  assert.equal(userAdcOption.id, "user-adc");
  assert.equal(userAdcOption.recommended, true);
  assert.equal(userAdcOption.keyless, true);
  assert.match(userAdcOption.commands[0], /gcloud auth login --enable-gdrive-access --update-adc --force/);
  assert.match(userAdcOption.commands[1], /set-quota-project my-project/);
});

test("Google auth readiness accepts the Drive scope for Sheets", async () => {
  const result = await diagnoseGoogleAuth({
    tokenProvider: async () => ({ token: "adc-secret", source: "user-adc" }),
    tokenInfoProvider: async () => ({ scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/drive" }),
    now: fixedNow
  });
  assert.equal(result.status, "ready");
  assert.equal(result.features.find((feature) => feature.id === "sheets").status, "ready");
  assert.equal(JSON.stringify(result).includes("adc-secret"), false);
});

test("Google auth readiness reports one ADC credential with both application scopes", async () => {
  const result = await diagnoseGoogleAuth({
    tokenProvider: async () => ({ token: "adc-secret", source: "user-adc" }),
    tokenInfoProvider: async () => ({ scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/spreadsheets" }),
    now: fixedNow
  });
  assert.equal(result.status, "ready");
  assert.equal(result.setupMode, "single-adc");
  assert.equal(result.features.find((feature) => feature.id === "sheets").status, "ready");
  assert.equal(result.features.find((feature) => feature.id === "cloud").status, "ready");
  assert.equal(JSON.stringify(result).includes("adc-secret"), false);
});

test("Google auth readiness handles missing ADC without exposing credentials", async () => {
  const result = await diagnoseGoogleAuth({
    tokenProvider: async () => { throw new Error("not logged in"); },
    now: fixedNow
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.features.every((feature) => feature.status === "unavailable"), true);
  assert.match(result.message, /not logged in/);
});

test("token introspection failure remains non-blocking and explicit", async () => {
  const result = await diagnoseGoogleAuth({
    tokenProvider: async () => ({ token: "secret", source: "adc" }),
    tokenInfoProvider: async () => { throw new Error("offline"); },
    now: fixedNow
  });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.missingScopes, []);
});
