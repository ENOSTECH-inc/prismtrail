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
  const serviceAccountOption = setupOptions[0];
  assert.equal(serviceAccountOption.recommended, true);
  assert.equal(serviceAccountOption.keyless, true);
  assert.match(serviceAccountOption.commands[0], /roles\/iam\.serviceAccountTokenCreator/);
  assert.match(serviceAccountOption.commands[0], /gcloud config get-value account/);
  assert.match(serviceAccountOption.commands[1], /--impersonate-service-account=/);
  assert.equal(serviceAccountOption.commands.some((command) => command.includes("set-quota-project")), false);
  assert.equal(serviceAccountOption.commands.some((command) => command.includes("client-id-file")), false);
  assert.match(serviceAccountOption.securityDocsUrl, /best-practices-for-managing-service-account-keys/);
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
