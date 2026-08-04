# Architecture

## Domain

- `DataAgent`: a local connection definition for an existing Google Cloud Data Agent. The app never creates, updates, or deletes the Google-side agent.
- `TestSuite`: a reusable collection of prompts, selected agents, thinking modes, and deterministic expectations.
- `Run`: the existing single-prompt execution capture, including normalized events and BigQuery job metadata.
- `SuiteRun`: an immutable suite snapshot plus one evaluated result per case. Completed runs also persist a bounded Gemini-generated `aiSummary`; it is commentary only and never changes deterministic scores, grades, or pass/fail state.
- `SheetConnection`: metadata for one ADC-accessible Google Spreadsheet. `sheetName` is the PrismTrail-managed display name, while `title` records the current Google-side title. The spreadsheet is owned by exactly one registered `DataAgent` through `agentId`. Cell values and access tokens are not persisted.

Domain JSON is persisted through a switchable primary-storage interface. Local storage uses
`data/<namespace>/<id>.json`; GCS uses
`gs://<bucket>/<prefix>/<namespace>/<id>.json`. The local bootstrap file
`data/storage-config.json` identifies the active backend and is not domain data.

## Primary storage portability

`LocalStorageBackend` and `GcsStorageBackend` implement the same `ensure`, `save`, `get`, `list`,
`validate`, and `describe` boundary. Existing stores therefore remain unaware of the selected
backend.

GCS is the recommended/default choice in the settings UI, including for local application runs.
A fresh installation temporarily boots from local storage when no bucket has been configured,
shows a `setup_required` state, and preselects GCS in the settings form. This keeps the
application bootable without silently treating the temporary local fallback as the intended
shared destination.

The settings API exposes four operations:

- read the active bootstrap configuration and storage statistics
- validate a proposed local or GCS destination and preview its registered data
- update an already prepared destination
- copy or synchronize all namespaces, optionally switching only after a successful copy

Migration first validates the destination, performs a dry-run conflict scan, copies without
deleting the source, persists bootstrap settings atomically, and switches the in-process backend
last. A failed validation or copy leaves the current backend active.

Destination previews use object metadata for counts, bytes, and latest update timestamps, then
download at most three representative JSON objects per namespace for display labels. This avoids
loading complete knowledge indexes merely to explain what will become visible after switching.

GCS objects are written with generation preconditions. Reads cache the observed generation and
subsequent writes use `ifGenerationMatch`; a concurrent modification returns a storage conflict
instead of silently overwriting newer data.

## Authentication

The local app uses Application Default Credentials:

```text
gcloud auth application-default print-access-token
```

The `google-auth-library` resolves ADC first. When the library cannot provide a token, the local
Node.js process may call `gcloud auth application-default print-access-token`; it never falls back
to the active non-ADC gcloud user token. Access tokens remain in memory and are never written to
JSON or sent to the browser.

The server requests the complete application scope set (`cloud-platform` and `spreadsheets`) and
exposes a token-free `GET /api/auth/readiness` preflight. It introspects the short-lived token,
caches only public capability status for one minute, and reports Cloud and Sheets readiness
separately. The shared UI renders failures on every page, links to the Settings authentication
panel, and blocks known-incompatible external API mutations before sending them. An unavailable
token-introspection service is reported as `unknown` and remains non-blocking so a temporary
diagnostic outage does not disable otherwise valid credentials.
Because Sheets is outside the Google Cloud scope set, recovery guidance uses keyless impersonation
of a service account that has been granted access to each spreadsheet. The UI does not present the
blocked bare-scope flow or a custom Desktop OAuth client flow.
Managed local environments prefer keyless impersonation from user ADC. The design does not create
downloaded service-account key JSON or store it in Secret Manager. The browser may interpolate a
validated service-account email into setup commands, but credentials and tokens never enter browser
state or API responses. Impersonated ADC uses the service account's project for quota and is not
compatible with the user-credential-only `gcloud auth application-default set-quota-project`
command.

## Execution

Suite cases run sequentially to limit rate and cost surprises. Each case calls the same Data Agent execution path as the single test screen, then evaluates:

- final response presence
- absence of response errors
- SQL generation when required
- chart generation when required
- duration ceiling
- billed-byte ceiling
- required response phrases

The suite report shows both the average score and hard pass rate. A Data Agent may return a valid answer while failing a suite contract, which is intentionally reported as a test failure rather than an infrastructure error.

## AI editor

The UI supports an Algolia-style command palette (`Ctrl/⌘K`, or the search control in the sidebar / case list) powered by Fuse.js. It fuzzy-searches cases (title, id, prompt), suites, reports, agents, and main pages, with keyboard navigation and recent selections.

Vertex AI returns structured JSON with a message and a constrained suite patch. The UI always previews the proposal, and the user explicitly applies or discards it before the suite is saved.

## GCS lightweight RAG

`KnowledgeSource` stores only a GCS bucket, prefix, display metadata, and sync status. The application uses ADC with the Cloud Storage JSON API to:

1. list accessible buckets for a validated Google Cloud project ID
2. let the user filter and select up to 20 buckets in an accessible multi-select combobox
3. list objects under the selected prefix
4. download supported text objects
5. normalize and chunk their text
6. store a local JSON index
7. retrieve relevant chunks using deterministic lexical scoring

Bucket discovery uses `GET /storage/v1/b?project=<projectId>` and requires `storage.buckets.list`. It is read-only; batch registration stores one `KnowledgeSource` per selected bucket/prefix and does not create or modify any bucket.

The UI has separate collection and detail layers. `GET /api/knowledge-sources/:id` resolves the local source and performs a live, read-only object listing. The detail screen owns upload and sync actions, Cloud Console deep links, and reverse references to suites. Uploading one or more supported files is sequential and followed by one automatic index sync, so the visible object and chunk counts reflect the completed operation.

Only retrieved chunks are sent to Vertex AI. Raw access tokens and unrelated bucket objects are never persisted in the index.

Each suite and case can reference knowledge source IDs. Case-level selections override suite defaults. After a Data Agent run, the normal deterministic checks run first. If relevant knowledge was retrieved, Vertex AI adds a separate `knowledge-grounding` check with a reason and object/chunk citations.

The same retrieval path grounds suite editing and the Data Agent planner. This keeps storage, retrieval, and generation behind separable functions so the local lexical retriever can later be replaced by Vertex AI Vector Search or another managed index.

## Google Sheets connector

The local server calls Google Sheets API v4 with the same short-lived ADC access token used by the Google Cloud integrations. A connection stores only spreadsheet metadata and operation timestamps.
The connection UI lives under the Settings `Google Sheets` tab (`#/settings/sheets`); the legacy
`#/sheets` route redirects there and the sidebar has no separate integration group.

Every registered Data Agent may own at most one Sheet connection, and one spreadsheet may belong to
at most one Data Agent. All connection, bootstrap, suite import/export, report export, catalog sync,
automatic report writeback, UI shortcuts, and MCP operations enforce that ownership on the server.
`AgentEval_DataAgents` contains only the owning agent, while `AgentEval_Suites` contains only suites
whose effective case agents resolve uniquely to that owner. Mixed-agent suites are never written to
a sheet. Legacy unowned connections are auto-assigned only when exactly one registered agent and one
unowned connection make the mapping unambiguous; otherwise they remain inactive until explicitly
reconnected with an Agent.

Exports use schema version 2; schema version 1 remains import-compatible:

- `AgentEval_TestSuite`: editable suite metadata and case rows (including free-form case `memo`, which is not used for scoring)
- `AgentEval_Report`: read-only exported suite-run results

Version 2 separates deterministic `systemRequirements` from checklist-style `businessRequirements`. Store checks as `criteriaItems` (Sheets column uses `;` separators; `accuracyCriteria` remains a joined compatibility string). The Vertex AI judge scores each item as sun/cloud/rain (☀️/☁️/☔️) in one call, using the full Conversational Analytics `Message` stream JSON plus compact official schema notes—not final text alone. The server derives A/B/C/D from mark weights (sun=1, cloud=0.5, rain=0: all sun→A, ratio≥0.9→B, ≥0.5→C, else D) and keeps per-item reasons. A/B pass by default; judge infrastructure failures become `review_required`, never a fabricated D grade. `requiredPhrases` matches final-response text only; `requiredSqlTables` matches identifiers in generated SQL, matched queries, and BigQuery job query text (not the answer prose).

Exports preserve the tab ID by clearing and rewriting only the fixed tab, then rebuilding a complete presentation layer: Japanese display headers, metadata panels, hidden gridlines, frozen rows/ID column, filters, banding, semantic number formats, data validation, conditional formatting, and the report score chart. Existing charts, banding, conditional formats, merges, and validations owned by the fixed tab are removed before the new definition is applied, preventing duplicate formatting across repeated exports.

Imports accept both the legacy machine-oriented English labels and the Japanese display labels, request unformatted cell values so unit-bearing number formats round-trip safely, ignore empty checkbox template rows, and still validate data types, registered Data Agent IDs, and the 120-case limit before calling the normal `normalizeSuite` path. A matching `suite_id` updates the local suite; otherwise the import creates a new local suite.

`POST /api/suites/import-paste` provides a lower-friction update path for cell ranges copied from Google Sheets. It accepts TSV or RFC-style quoted CSV up to 500,000 characters. A complete managed sheet resolves the destination from its embedded suite ID; a case table or case rows require an explicit existing target suite. The server reconstructs the fixed schema, validates field types, Data Agent and knowledge references, and the 120-case limit, then atomically saves through the normal suite store. It never creates a new suite and performs no write on validation failure.

## Live suite execution

`POST /api/suites/:id/run` creates and persists a `running` Suite Run, returns `202 Accepted` immediately, and schedules Data Agent work in the local server process with bounded parallelism (default and max 30 concurrent cases via `SUITE_RUN_CONCURRENCY`). An optional JSON body `{ "caseIds": ["case_…"] }` runs only those cases (used by the editor’s single-case run); omitted `caseIds` runs the full suite. A second run of the same suite is rejected with `409` while status is `running` or `cancelling`. Progress is persisted through `activeCases` / `currentCase`, `caseRuns`, cumulative summary, and timestamps. `GET /api/suite-runs/:id` is therefore a durable polling boundary used by the live report UI; navigation or browser reload does not discard already persisted progress.

`POST /api/suite-runs/:id/cancel` aborts the in-process controller for a live run (status becomes `cancelling`, then `cancelled`). Already finished case results are kept; in-flight Data Agent calls are aborted via `AbortSignal`; cases that never started are recorded as `cancelled`. If the process restarted and the in-memory controller is gone, cancel force-finalizes the persisted run as `cancelled` so the suite is not stuck behind a 409.

Google Sheets mutations (suite/report/catalog export-import and automatic report writeback) are serialized per spreadsheet ID so concurrent suite completions cannot interleave clear/rewrite of managed tabs. Connection binding changes are also serialized in-process so concurrent registrations cannot violate the one-spreadsheet/one-agent invariant. After the final case, the Run is finalized before external reporting begins. `sheetExport.status` then moves from `pending` to `exporting` and finally to `succeeded`, `failed`, or `skipped`. The automatic destination is the one ready connection whose `agentId` matches the Suite Run's immutable suite snapshot; recent activity never changes routing. Export failure is recorded on the Run without changing the completed evaluation result.

SQL evidence is normalized across three valid execution paths: a `data.generated_sql` event, a verified `data.matched_query` carrying `exampleQuery.sqlQuery`, or a BigQuery query job. This prevents the verified-query reuse path from failing `requireSql`. Run detail responses also resolve their originating Suite Run and case by stored context or reverse lookup, allowing old and new runs to render the same breadcrumb and back-navigation contract. Completed Suite Runs with the legacy false-negative SQL check are corrected in the API view without mutating the original trace.

## PDF export

QA-oriented PDF downloads are generated server-side with pdfme (`@pdfme/generator`) and an embedded Noto Sans JP font (`assets/fonts/`, downloaded on first use or during Docker build). The print-safe report system follows a TestRail-style review flow: Gemini's non-authoritative AI comment, KPI cards, status and business-grade distributions, explicitly paginated test-result indexes, then case-level outcome, deterministic checks, business acceptance criteria, and evidence. Color is reserved for hierarchy and result state.

After case evaluation finishes, the server sends a compact result-only projection to Vertex AI and stores a structured AI comment (`headline`, `comment`, strengths, concerns, and next actions). Raw message streams are excluded from this summary request. Summary generation and Google Sheets export run independently; a Gemini failure is recorded for retry through `POST /api/suite-runs/:id/ai-summary` and cannot change or block the completed evaluation result. The report UI and integrated PDF consume the same persisted comment.

PDF layouts do not rely on renderer-driven table pagination. Every logical report page is composed on a fixed A4 grid and large collections are chunked before rendering. The compact test index fits up to 14 cases per page without repeating cover-page summary metrics. Index rows carry internal PDF `GoTo` links to their case overview, while non-cover pages expose a header link back to the report summary (or the case overview for partial reports). This keeps headers, rows, footers, and navigation deterministic. `npm run report:samples` generates representative case-spec, single-case result, and full suite-run PDFs under `output/pdf/` for visual regression review; tests also assert that each logical input produces exactly one PDF page.

PDF evaluation summaries use A/B/C/D as the primary display for system, business, and overall evaluation. Stored numeric scores remain available as supporting audit information. Numeric system and overall scores are mapped consistently as A = 100, B = 90–99, C = 50–89, and D = below 50; business grades returned by the business evaluator remain authoritative, and an unconfigured business evaluation is shown as `—` rather than inferred.

- Case specs: `GET /api/suites/:id/export/case-pdf?caseId=` (one case) and `GET /api/suites/:id/export/cases-pdf` (all cases as one multi-page PDF)
- Suite-run reports: `GET /api/suite-runs/:id/export/pdf` (Runs Summary cover + case detail pages). Partial / single-case runs (`partialRun` or `?caseId=`) omit the cover and export case detail only. Every case is labeled as a test-case execution report with its case ID and JST start time, and includes a dedicated paginated execution-trace page containing the full user prompt and de-duplicated SQL body. Case pages also include the result banner, system/business check tables, and a short evidence preview (answer / sample table / chart note).

Live (`running` / `cancelling`) suite runs return `409`. The UI exposes download buttons on the suite case editor and the evaluation report detail page; browser print remains available as a fallback.

Each PDF detail page includes a clickable link back into the app (base URL defaults to `http://127.0.0.1:4318`, overridable via `PRISMTRAIL_APP_BASE_URL`). Case specs open `#/suites/:suiteId/edit/:caseId`. Suite-run covers and each case overview carry a compact three-link reference table for the GCP Data Agent resource, the local suite editor, and the local suite-run report; redundant per-page run-detail links are omitted. Case pages identify their position as evaluation, prompt/SQL, or response/data/chart, and internal PDF links connect the case index, case overviews, and report summary. Headers distinguish the overall report from individual case reports, and every generated page is marked `CONFIDENTIAL｜機密情報・外部共有禁止` by default. URI and GoTo annotations are attached after pdfme generation.

## MCP integration

`/mcp` implements stateless Streamable HTTP JSON-RPC for protocol versions `2025-11-25` and
`2025-06-18`. Its 42-tool registry covers all non-destructive UI integration boundaries and is an
explicit allow-list; it never proxies arbitrary REST paths.
Each tool declares a narrow scope, and the server checks that scope again immediately before the
handler. Input schemas reject unknown top-level arguments, requests are capped at 1 MiB, Origins
are same-host by default, and each token has an in-memory request rate limit.

MCP credentials and the metadata-only audit trail live under the local bootstrap data directory,
outside the switchable domain-storage namespaces. Plaintext tokens are generated from 256 bits of
randomness, returned once, and never persisted. Suite and case writes require the caller's last
observed `updatedAt`, preventing a coding agent from silently replacing a concurrent edit.

Primary-storage switching is a two-step capability. A dry-run validates the destination, checks
conflicts, binds a confirmation ID to the token and storage revision, and expires it after five
minutes. The switch repeats validation and the conflict scan, copies without deleting the source,
then atomically updates the bootstrap configuration and swaps the in-process backend.

## Deployment boundary

The server bind address is configurable. Direct Node.js startup defaults to `127.0.0.1`; the
Docker image sets `HOST=0.0.0.0` and exposes port 4318. Docker Compose mounts the host gcloud
configuration read-only, persists bootstrap/local data in a named volume, and obtains tokens
through `google-auth-library` ADC without requiring gcloud inside the image.

Docker Compose publishes the container port only on host `127.0.0.1`. The HTTP server sets a
restrictive Content Security Policy, frame denial, MIME sniffing protection, a no-referrer policy,
and a limited Permissions Policy. Runtime data and environment-specific identifiers are excluded
from Git.

GCS provides a portable shared data layer, but it is not application authentication. A
team-hosted network service should use workload identity or a dedicated service account and add
application-level authentication before exposing the HTTP server beyond trusted local machines.
