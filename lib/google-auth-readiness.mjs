import { GOOGLE_ADC_SCOPES, getAccessToken } from "./google-cloud.mjs";

export const GOOGLE_AUTH_FEATURES = Object.freeze([
  {
    id: "cloud",
    label: "Google Cloud APIs",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    features: ["Data Agent", "BigQuery", "Vertex AI", "Cloud Storage"]
  },
  {
    id: "sheets",
    label: "Google Sheets API",
    scope: "https://www.googleapis.com/auth/spreadsheets",
    acceptedScopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file"
    ],
    features: ["Google Sheets import/export", "automatic report writeback"]
  }
]);

export const GOOGLE_ADC_SCOPE_LIST = GOOGLE_ADC_SCOPES.join(",");
export const GOOGLE_USER_ADC_COMMAND =
  "gcloud auth login --enable-gdrive-access --update-adc --force";
export const GOOGLE_USER_ADC_QUOTA_COMMAND =
  "gcloud auth application-default set-quota-project GOOGLE_CLOUD_PROJECT";

export function googleAuthSetupOptions(projectId = "") {
  return [
    {
      id: "user-adc",
      recommended: true,
      keyless: true,
      commands: [
        GOOGLE_USER_ADC_COMMAND,
        GOOGLE_USER_ADC_QUOTA_COMMAND.replace("GOOGLE_CLOUD_PROJECT", projectId || "GOOGLE_CLOUD_PROJECT")
      ],
      docsUrl: "https://cloud.google.com/sdk/gcloud/reference/auth/login",
      securityDocsUrl: null
    }
  ];
}

function normalizedScopes(info = {}) {
  const raw = Array.isArray(info.scopes) ? info.scopes : String(info.scope || "").split(/[\s,]+/);
  return [...new Set(raw.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function publicFeature(feature, scopes) {
  const acceptedScopes = feature.acceptedScopes || [feature.scope];
  const granted = acceptedScopes.some((scope) => scopes.includes(scope));
  return { ...feature, status: granted ? "ready" : "missing", granted };
}

async function defaultTokenInfoProvider(token) {
  const { OAuth2Client } = await import("google-auth-library");
  return new OAuth2Client().getTokenInfo(token);
}

export async function diagnoseGoogleAuth({
  tokenProvider = getAccessToken,
  tokenInfoProvider = defaultTokenInfoProvider,
  now = () => new Date()
} = {}) {
  const checkedAt = now().toISOString();
  let tokenResult;
  try {
    tokenResult = await tokenProvider();
  } catch (error) {
    return {
      status: "unavailable",
      checkedAt,
      authSource: null,
      features: GOOGLE_AUTH_FEATURES.map((feature) => ({ ...feature, status: "unavailable", granted: false })),
      missingScopes: [...GOOGLE_ADC_SCOPES],
      command: GOOGLE_USER_ADC_COMMAND,
      setupMode: "unavailable",
      message: `Application Default Credentialsを利用できません: ${error.message}`
    };
  }

  try {
    const info = await tokenInfoProvider(tokenResult.token);
    const scopes = normalizedScopes(info);
    const features = GOOGLE_AUTH_FEATURES.map((feature) => publicFeature(feature, scopes));
    const missingScopes = features.filter((feature) => !feature.granted).map((feature) => feature.scope);
    return {
      status: missingScopes.length ? "limited" : "ready",
      checkedAt,
      authSource: tokenResult.source,
      expiresAt: info.expiry_date ? new Date(info.expiry_date).toISOString() : null,
      features,
      missingScopes,
      command: GOOGLE_USER_ADC_COMMAND,
      setupMode: "single-adc",
      message: missingScopes.length
        ? "ADCは1本で確認できましたが、必要なOAuth scopeが不足しています。"
        : "必要なGoogle OAuth scopeがすべて利用できます。"
    };
  } catch (error) {
    return {
      status: "unknown",
      checkedAt,
      authSource: tokenResult.source,
      features: GOOGLE_AUTH_FEATURES.map((feature) => ({ ...feature, status: "unknown", granted: null })),
      missingScopes: [],
      command: GOOGLE_USER_ADC_COMMAND,
      message: `ADCトークンは取得できましたが、scopeを確認できませんでした: ${error.message}`
    };
  }
}
