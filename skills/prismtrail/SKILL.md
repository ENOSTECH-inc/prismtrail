---
name: prismtrail
description: Set up, operate, test, and extend PrismTrail. Use when a coding agent needs to configure ADC, register a supported data agent, create or import test suites, run evaluations, inspect system/business scores, export Google Sheets reports, configure storage, modify the application, or verify Docker-based local startup.
---

# PrismTrail

Operate this repository as a local-first evaluation system for existing BigQuery Data Agents.
Preserve the distinction between deterministic system requirements and Gemini-judged business
requirements.

## MCP-first execution

When inspecting, registering, executing, or validating PrismTrail resources, use the configured
PrismTrail MCP server and its API tools first. Do not use browser automation or open the PrismTrail
UI to perform an operation when an MCP tool can do it.

Use the browser only when the user explicitly asks for visual/UI verification, or when the MCP
connection is unavailable and that limitation is reported before falling back. For a local
instance, obtain the endpoint from the app's MCP configuration and use its `/mcp` endpoint
(normally `http://127.0.0.1:4318/mcp`). Never expose or repeat the MCP token in output. If the
matching MCP operation is unclear, inspect the available MCP tools and schemas rather than
switching to the browser.

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
gcloud auth login --enable-gdrive-access --update-adc --force
gcloud auth application-default set-quota-project GOOGLE_CLOUD_PROJECT
```

Google Sheets is outside the Google Cloud scope set. For local use without a service account, use
the gcloud Drive-enabled login above and share the target spreadsheet with that user. The command
writes one user credential to ADC for Cloud, GCS, Data Agent, and Sheets operations. The Sheets API
accepts the Drive scope granted by `--enable-gdrive-access`; IAM permissions, spreadsheet ACLs, API
enablement, and quota-project setup are still required.

Do not instruct users to run `gcloud auth application-default login --scopes=...spreadsheets`
without `--client-id-file`: Google blocks non-Cloud scopes through the default ADC OAuth client. If
Workspace policy also blocks the recommended gcloud app, use an administrator-approved Desktop OAuth
client as the fallback:

```bash
gcloud auth application-default login \
  --client-id-file=OAUTH_CLIENT_FILE \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets
gcloud auth application-default set-quota-project GOOGLE_CLOUD_PROJECT
```

Never commit the OAuth client JSON or place it in the repository.

Do not substitute `gcloud auth print-access-token` or place credentials in source files.
Before a Google-backed operation, inspect **Settings → Google authentication** or
`GET /api/auth/readiness`. Treat `limited` and `unavailable` as blocking; `unknown` means token
introspection failed and should be verified through the target API. Never expose the token.

## Run

Prefer Docker Compose:

```bash
npm run setup -- up --detach
docker compose ps
```

The UI is available at `http://127.0.0.1:4318` unless `APP_PORT` changes it.
Use `Ctrl/⌘K` (or the search control) for Algolia-style quick search across cases, suites, reports, and pages.

Use direct Node.js startup only for development:

```bash
npm ci
npm start
```

## Configure evaluations

- Register existing agents by full resource name:
  `projects/<project>/locations/<location>/dataAgents/<id>`.
- Put execution constraints such as SQL, chart, duration, billed bytes, required phrases, and
  required SQL tables under system requirements.
- `requiredPhrases` checks the final answer text. `requiredSqlTables` checks generated/matched SQL
  (and job query text) for table identifiers; it does not look at answer prose.
- Put expected values, periods, units, and tolerances as a `;`-separated business checklist
  (`criteriaItems`). Do not enable business scoring without at least one verifiable item.
- The judge receives the full Data Agent `Message` JSON plus schema notes and returns
  sun/cloud/rain per item; the server computes A/B/C/D from those marks.
- Treat A/B as passing by default. Preserve C/D as accuracy failures and judge infrastructure
  errors as review-required rather than fabricating a grade.
- Prefer the managed Google Sheet for bulk test-case editing. Import it before running a changed
  suite, and confirm the Suite ID and case count.
- Case `memo` is free-form reference text (model/metrics notes). It is stored and synced to Sheets,
  but is not used by evaluation scoring.
- Store provenance links in case `relatedUrls` as an array of up to 20 HTTP(S) URLs. Use the
  original Slack message, ticket, document, or other source URL when it explains why the case was
  added or changed. The links round-trip through the UI, MCP, Sheets, history, and case-spec PDFs.
- Prefer suite evaluation over ad-hoc `/api/runs` when the user cares about pass/fail criteria.
- From the suite editor, **このケースを実行** runs one case via `POST /api/suites/:id/run` with `{ "caseIds": [...] }`, then opens the evaluation detail (`#/reports/:id`) with a live skeleton until results appear; **スイートを実行** still runs the full suite and opens the same report page.
- For stakeholder handoff, prefer PDF export over screenshots:
  - Suite editor → **このケースをPDF** / **全ケースをPDF** (case specification, TestRail case-print style)
  - Evaluation report → **PDF出力** (full run: Runs Summary cover with status pie + case index, then case details)
  - Single-case / partial runs export **case detail only** (no suite cover page)
  - Endpoints live under `/api/suites/:id/export/*-pdf` and `/api/suite-runs/:id/export/pdf`
  - Generation uses pdfme on the server with Noto Sans JP; SVG pie/bar charts are embedded for at-a-glance status
  - PDFs include a clickable link to open the case editor or run/report page (`http://127.0.0.1:4318` by default)

## Bulk-edit test cases via Google Sheets

Preferred path when the user asks to add or revise many cases:

1. Confirm spreadsheet ID / connection and target suite (never invent them).
2. Open **Settings → Google Sheets**, register the spreadsheet by `spreadsheetUrl` and its PrismTrail-managed `sheetName`, then link exactly one registered Data Agent. MCP `connect_google_sheet` requires `spreadsheetUrl`, `sheetName`, and the registered local `agentId`.
3. Create or PATCH a suite whose default/case Agent IDs all resolve to that same Agent. Mixed-Agent suites cannot use Sheets.
4. Push to Sheets with `POST /api/sheets/connections/:id/export-suite` and `{ "suiteId": "..." }`.
   This overwrites the managed `AgentEval_TestSuite` tab for that connection.
5. Or open the editor UI → **テストケース** → **Gシートで編集** (save + export to that Agent's connection, then open).
6. Edit rows in Sheets. Sheet **Data Agent ID** values are the GCP remote id
   (for example `agent_marketing_marts_core_adhoc_v1`), not PrismTrail local ids.
7. Bring changes back with suite paste import (`/api/suites/import-paste`) or
   `POST /api/sheets/connections/:id/import-suite`.
8. Accept Sheets display formats such as `120,000 ms` / `0 bytes` when pasting; the importer
   normalizes them.

Managed tabs owned by the app:

- `AgentEval_TestSuite` — active suite definition (metadata + cases)
- `AgentEval_Report` — run report export
- `AgentEval_DataAgents` — only the Data Agent that owns this spreadsheet
- `AgentEval_Suites` — only suites owned exclusively by that Data Agent

Do not modify unrelated user tabs on the same spreadsheet.

### Case status and suite runs

- Each case has `status`: `active`（実行可） or `draft`（下書き）.
- Sheets show Japanese labels `実行可` / `下書き` in the case **ステータス** column.
- Missing status on import defaults to `active` for backward compatibility.
- Suite evaluation skips `draft` cases and records them as `skipped` in the report.
- A suite with zero runnable cases cannot start a run.
- The same suite cannot start a second run while status is `running` or `cancelling`.
- `POST /api/suite-runs/:id/cancel` stops a live run; unfinished cases become `cancelled`.
- Google Sheets writes are serialized per spreadsheet so parallel suite completions cannot corrupt managed tabs.

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
