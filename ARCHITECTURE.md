# Architecture

## Domain

- `DataAgent`: a local connection definition for an existing Google Cloud Data Agent. The app never creates, updates, or deletes the Google-side agent.
- `TestSuite`: a reusable collection of prompts, selected agents, thinking modes, and deterministic expectations.
- `Run`: the existing single-prompt execution capture, including normalized events and BigQuery job metadata.
- `SuiteRun`: an immutable suite snapshot plus one evaluated result per case.
- `SheetConnection`: metadata for one ADC-accessible Google Spreadsheet. Cell values and access tokens are not persisted.

Domain JSON is persisted through a switchable primary-storage interface. Local storage uses
`data/<namespace>/<id>.json`; GCS uses
`gs://<bucket>/<prefix>/<namespace>/<id>.json`. The local bootstrap file
`data/storage-config.json` identifies the active backend and is not domain data.

## Primary storage portability

`LocalStorageBackend` and `GcsStorageBackend` implement the same `ensure`, `save`, `get`, `list`,
`validate`, and `describe` boundary. Existing stores therefore remain unaware of the selected
backend.

GCS is the recommended/default choice in the settings UI for shared use. A fresh installation
still starts on local storage when no bucket has been configured, so the application remains
bootable and existing data is never implicitly moved.

The settings API exposes four operations:

- read the active bootstrap configuration and storage statistics
- validate a proposed local or GCS destination
- update an already prepared destination
- copy or synchronize all namespaces, optionally switching only after a successful copy

Migration first validates the destination, performs a dry-run conflict scan, copies without
deleting the source, persists bootstrap settings atomically, and switches the in-process backend
last. A failed validation or copy leaves the current backend active.

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

The right-side assistant sends only the suite definition, registered agent summaries, and recent conversation turns to Vertex AI. It does not send raw BigQuery rows, access tokens, or run traces.

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

Exports use schema version 2; schema version 1 remains import-compatible:

- `AgentEval_TestSuite`: editable suite metadata and case rows
- `AgentEval_Report`: read-only exported suite-run results

Version 2 separates deterministic `systemRequirements` from natural-language `businessRequirements`. The latter is judged by the configured Vertex AI judge model and stored as A/B/C/D with an independent reason, evidence, discrepancy list, model, and audit metadata. A/B pass by default; judge infrastructure failures become `review_required`, never a fabricated D grade.

Exports preserve the tab ID by clearing and rewriting only the fixed tab, then rebuilding a complete presentation layer: Japanese display headers, metadata panels, hidden gridlines, frozen rows/ID column, filters, banding, semantic number formats, data validation, conditional formatting, and the report score chart. Existing charts, banding, conditional formats, merges, and validations owned by the fixed tab are removed before the new definition is applied, preventing duplicate formatting across repeated exports.

Imports accept both the legacy machine-oriented English labels and the Japanese display labels, request unformatted cell values so unit-bearing number formats round-trip safely, ignore empty checkbox template rows, and still validate data types, registered Data Agent IDs, and the 50-case limit before calling the normal `normalizeSuite` path. A matching `suite_id` updates the local suite; otherwise the import creates a new local suite.

`POST /api/suites/import-paste` provides a lower-friction update path for cell ranges copied from Google Sheets. It accepts TSV or RFC-style quoted CSV up to 500,000 characters. A complete managed sheet resolves the destination from its embedded suite ID; a case table or case rows require an explicit existing target suite. The server reconstructs the fixed schema, validates field types, Data Agent and knowledge references, and the 50-case limit, then atomically saves through the normal suite store. It never creates a new suite and performs no write on validation failure.

## Live suite execution

`POST /api/suites/:id/run` creates and persists a `running` Suite Run, returns `202 Accepted` immediately, and schedules the sequential Data Agent work in the local server process. Before each case and after each evaluation, the server persists `currentCase`, `caseRuns`, cumulative summary, and timestamps. `GET /api/suite-runs/:id` is therefore a durable polling boundary used by the live report UI; navigation or browser reload does not discard already persisted progress.

After the final case, the Run is finalized before external reporting begins. `sheetExport.status` then moves from `pending` to `exporting` and finally to `succeeded`, `failed`, or `skipped`. The most recently used ready Sheets connection is the automatic destination. Export failure is recorded on the Run without changing the completed evaluation result.

SQL evidence is normalized across three valid execution paths: a `data.generated_sql` event, a verified `data.matched_query` carrying `exampleQuery.sqlQuery`, or a BigQuery query job. This prevents the verified-query reuse path from failing `requireSql`. Run detail responses also resolve their originating Suite Run and case by stored context or reverse lookup, allowing old and new runs to render the same breadcrumb and back-navigation contract. Completed Suite Runs with the legacy false-negative SQL check are corrected in the API view without mutating the original trace.

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
