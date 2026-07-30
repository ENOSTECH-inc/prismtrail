---
name: prismtrail
description: Set up, operate, test, and extend PrismTrail. Use when a coding agent needs to configure ADC, register a supported data agent, create or import test suites, run evaluations, inspect system/business scores, export Google Sheets reports, configure storage, modify the application, or verify Docker-based local startup.
---

# PrismTrail

Operate this repository as a local-first evaluation system for existing BigQuery Data Agents.
Preserve the distinction between deterministic system requirements and Gemini-judged business
requirements.

## Start safely

1. Work from the repository root.
2. Run `npm run setup -- doctor`.
3. If `.env` is missing, run `npm run setup -- init`.
4. Never invent a Google Cloud project, Data Agent resource name, expected business value, bucket,
   or spreadsheet ID. Ask the user for missing identifiers.
5. Never print, persist, copy, or commit ADC access tokens, service-account keys, `.env`, runtime
   `data/`, or evaluation traces.
6. Keep Docker's published port bound to `127.0.0.1` unless the user has added application
   authentication and explicitly requests a network deployment.

## Authenticate

Use Application Default Credentials only:

```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets
gcloud auth application-default set-quota-project GOOGLE_CLOUD_PROJECT
```

Do not substitute `gcloud auth print-access-token` or place credentials in source files.

## Run

Prefer Docker Compose:

```bash
npm run setup -- up --detach
docker compose ps
```

The UI is available at `http://127.0.0.1:4318` unless `APP_PORT` changes it.

Use direct Node.js startup only for development:

```bash
npm ci
npm start
```

## Configure evaluations

- Register existing agents by full resource name:
  `projects/<project>/locations/<location>/dataAgents/<id>`.
- Put execution constraints such as SQL, chart, duration, billed bytes, and required phrases under
  system requirements.
- Put expected values, periods, units, and tolerances in the natural-language business
  requirement. Do not enable a business requirement without a verifiable expectation.
- Treat A/B as passing by default. Preserve C/D as accuracy failures and judge infrastructure
  errors as review-required rather than fabricating a grade.
- Prefer the managed Google Sheet for bulk test-case editing. Import it before running a changed
  suite, and confirm the Suite ID and case count.

## Bulk-edit test cases via Google Sheets

Preferred path when the user asks to add or revise many cases:

1. Confirm spreadsheet ID / connection and target suite (never invent them).
2. Register the Data Agent if missing, then create or PATCH the suite via `/api/suites`.
3. Push to Sheets with `POST /api/sheets/connections/:id/export-suite` and `{ "suiteId": "..." }`.
   This overwrites the managed `AgentEval_TestSuite` tab for that connection.
4. Or open the editor UI → **テストケース** → **Gシートで編集** (save + export, then open).
5. Edit rows in Sheets. Sheet **Data Agent ID** values are the GCP remote id
   (for example `agent_marketing_marts_core_adhoc_v1`), not PrismTrail local ids.
6. Bring changes back with suite paste import (`/api/suites/import-paste`) or
   `POST /api/sheets/connections/:id/import-suite`.
7. Accept Sheets display formats such as `120,000 ms` / `0 bytes` when pasting; the importer
   normalizes them.

Managed tabs owned by the app:

- `AgentEval_TestSuite` — active suite definition (metadata + cases)
- `AgentEval_Report` — run report export
- `AgentEval_DataAgents` — registered agent catalog
- `AgentEval_Suites` — suite catalog

Do not modify unrelated user tabs on the same spreadsheet.

### Case status and suite runs

- Each case has `status`: `active`（実行可） or `draft`（下書き）.
- Sheets show Japanese labels `実行可` / `下書き` in the case **ステータス** column.
- Missing status on import defaults to `active` for backward compatibility.
- Suite evaluation skips `draft` cases and records them as `skipped` in the report.
- A suite with zero runnable cases cannot start a run.

### Mart / table coverage suites

When covering agent knowledge sources (for example 1 mart = 1 case):

1. Read the live Data Agent (`GET .../dataAgents/<id>`) and use published table references /
   system instructions. Do not invent table names.
2. Create one smoke case per table. Prefer system requirements only until real expected values
   are known; leave business accuracy empty rather than fabricating numbers.
3. Fact tables: period-bounded count/trend prompts with `requireSql: true` (and chart when the
   agent instructions require visuals). Dim/master tables: count or attribute lookup prompts.
4. Keep prompts explicit about `dataset.table` so the agent targets the intended mart.
5. Export the suite to the user-designated spreadsheet and report Suite ID + case count.

## Handle data and integrations

- Treat run traces, BigQuery job metadata, spreadsheet connections, GCS object names, and business
  expectations as potentially sensitive.
- Keep local runtime data under ignored `data/` or use the configured GCS primary storage.
- Before enabling GCS writes, confirm the exact bucket and prefix. Sync is read-only; upload is a
  separate explicit action.

## Change the code

1. Read `ARCHITECTURE.md` before changing persistence, evaluation semantics, or integrations.
2. Reuse server-side validation; never trust pasted sheets, browser fields, hidden columns, or
   model output.
3. Escape all untrusted text before inserting it into HTML.
4. Keep secrets out of logs and API responses.
5. Run:

```bash
npm test
npm audit --omit=dev --audit-level=high
docker compose build
```

For UI or integration changes, run the nearest real workflow with a non-production project and
record what was verified without committing identifiers or traces.

## Handoff

Report the commands run, affected integration, test results, and any cloud operation performed.
Call out skipped live tests and required Google Cloud permissions explicitly.
