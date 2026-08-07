<p align="center">
  <img src="./public/assets/prismtrail-mark.png" alt="PrismTrail logo" width="168">
</p>

# PrismTrail

[日本語](./README.ja.md) · [Architecture](./ARCHITECTURE.md) · [Security](./SECURITY.md) · [Contributing](./CONTRIBUTING.md)

> Local-first evaluation, regression testing, and reporting for data agents.

[![CI](https://github.com/ENOSTECH-inc/prismtrail/actions/workflows/ci.yml/badge.svg)](https://github.com/ENOSTECH-inc/prismtrail/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](https://nodejs.org/)

<p align="center">
  <img src="./docs/prismtrail-concept.png" alt="PrismTrail concept: test inputs flow through a data-agent adapter into system and business requirement evaluation, evidence, cost, and latency reporting." width="1200">
</p>

PrismTrail turns repeatable business questions into test suites. Its first adapter executes them
against an existing BigQuery Data Agent, captures response traces and BigQuery job metadata,
evaluates deterministic behavior and business acceptance conditions separately, and produces team-friendly
reports in the web UI and Google Sheets.

The project is designed for local workstations and coding agents. It uses Google Cloud
Application Default Credentials (ADC); credentials and access tokens are never stored in the
repository or browser.

> [!IMPORTANT]
> This is an independent community project, not an official Google product. BigQuery Data Agents
> and related APIs may have availability, quota, billing, and permission requirements. Review the
> [official Google Cloud documentation](https://docs.cloud.google.com/bigquery/docs/create-data-agents)
> before running evaluations.

## Why this project

Evaluating analytics agents involves more than checking whether a response arrived:

- Did the agent execute SQL when required?
- Did it create the requested visualization?
- Did it remain within latency and billed-byte limits?
- Is the returned business value actually correct?
- Can a team reproduce, review, and share the result?

This project models those concerns explicitly:

| Layer | What it checks | Result |
|---|---|---|
| System requirements | final response, errors, SQL evidence, chart evidence, duration, billed bytes, required phrases | pass/fail checks and score |
| Business requirements | qualitative and quantitative acceptance conditions | Gemini judge grade A/B/C/D |
| Reporting | suite progress, trace, cost, scores, evidence, and errors | web report and managed Google Sheet |

## Features

- Single-prompt test runs with normalized response traces
- Reusable test suites with live progress and resumable report URLs
- Separate system and business-requirement scores
- A/B/C/D business grading with evidence and review-required judge failures
- Checklist-style business acceptance conditions judged against the full Data Agent response
- BigQuery SQL evidence from generated SQL, matched verified queries, and query jobs
- BigQuery duration and billed-byte reporting
- Existing Data Agent registry using full Google Cloud resource names
- Google Sheets import/export with fixed schemas, validation, formatting, charts, and report writeback
- GCS knowledge sources, text upload, lightweight retrieval, and grounding checks
- Local or GCS primary storage with non-destructive migration and optimistic concurrency
- Docker Compose startup on macOS, Windows, and Linux
- Setup/diagnostic CLI and a bundled coding-agent skill
- Complete Japanese and English UI with a persistent language switcher

The web UI initially follows the browser language (`ja` for Japanese browsers, English
otherwise). Use the language switcher in the application header or Settings to change it;
the preference is saved only in the local browser.

## Quick start

### Prerequisites

- Docker Engine/Desktop with Compose
- Google Cloud CLI
- A Google Cloud project with access to an existing BigQuery Data Agent
- Permissions for the Data Agent, its BigQuery data, Vertex AI, and any optional GCS/Sheets resources
- Node.js 20+ for the setup CLI and local development

Enable the APIs required by your environment. The official Data Agent documentation currently
lists BigQuery, Gemini Data Analytics, Gemini for Google Cloud, and Knowledge Catalog APIs.
Google Sheets and Cloud Storage integrations additionally require their corresponding APIs.

### 1. Clone and install

```bash
git clone https://github.com/ENOSTECH-inc/prismtrail.git
cd prismtrail
npm ci
```

### 2. Create local configuration

The setup CLI validates identifiers and writes a git-ignored `.env`. It does not request or store
access tokens.

```bash
npm run setup -- init
```

For non-interactive coding agents:

```bash
npm run setup -- init \
  --project your-google-cloud-project \
  --agent projects/your-google-cloud-project/locations/global/dataAgents/your-agent-id \
  --label "My Data Agent"
```

### 3. Authenticate with ADC

```bash
gcloud auth login --enable-gdrive-access --update-adc --force
gcloud auth application-default set-quota-project YOUR_GOOGLE_CLOUD_PROJECT
```

After startup, open **Settings → Google authentication** to preflight ADC and the required
Cloud / Sheets scopes. For local use, one Drive-enabled user ADC credential can power Cloud, GCS,
Data Agent, and Sheets without a service account. Share the target sheet with
that Google account and configure the required IAM permissions and APIs. Known missing capabilities are shown across every page
and Google-backed operations are stopped before a request is sent. Access tokens are never
returned to the browser.
Google blocks adding the `spreadsheets` scope directly through gcloud's default ADC client. Use the
Drive-enabled login above.

Prefer user ADC for local use and Workload Identity for hosted deployments.

### 4. Diagnose and start

```bash
npm run setup -- doctor
npm run setup -- up --detach
docker compose ps
```

Open [http://127.0.0.1:4318](http://127.0.0.1:4318). The published Docker port is bound to the
loopback interface by default.

Stop the service:

```bash
docker compose down
```

Local application data is stored in the `prismtrail-data` named volume unless GCS primary
storage is configured. `docker compose down -v` deletes that volume and should only be used for an
intentional reset.

## Setup CLI

The repository includes `prismtrail`:

```text
prismtrail init     Create a validated, git-ignored .env
prismtrail doctor   Check Node, Docker, gcloud, ADC, and configuration
prismtrail up       Build and start Docker Compose
prismtrail skill    Print or install the bundled coding-agent skill
```

Use it through `npm run setup -- <command>` without installing anything globally. The `bin` entry
also supports `npm link` for contributors.

## Coding-agent skill

The repository includes [`skills/prismtrail/SKILL.md`](./skills/prismtrail/SKILL.md).
It gives coding agents the project-specific safety, setup, validation, data-handling, and testing
workflow.

Codex users can copy or symlink the skill directory into `~/.codex/skills/`. Other agents can be
instructed to read the file before modifying or operating the project.

```bash
npm run setup -- skill
# Codex: install the skill into ~/.codex/skills/prismtrail
npm run setup -- skill --install codex
# Claude Code: install a project-local skill under .claude/skills/prismtrail
npm run setup -- skill --install claude
```

## Core workflow

1. Register an existing Data Agent with its full resource name.
2. Create a test suite in the app or export the managed Google Sheet.
3. Define system requirements and optional natural-language business requirements.
4. Run the suite and watch cases populate in real time.
5. Review traces, SQL/job evidence, scores, costs, and business-grade explanations.
6. Share or re-export `AgentEval_Report`.

### Business grading

Describe the expected value, date range, unit, and permitted tolerance in natural language. The
configured Vertex AI judge compares the requirement with the agent response and structured data:

- **A** — complete match
- **B** — materially correct
- **C** — partially incorrect
- **D** — incorrect

A and B pass by default. A judge infrastructure failure is reported as review-required instead
of being converted into a fabricated D grade.

## Google Sheets

Open **Settings → Google Sheets**, share spreadsheets with the ADC identity, and register each spreadsheet by URL and a PrismTrail-managed
sheet name, then link one registered Data Agent. Three agents therefore use three isolated spreadsheets. Suite import/export, report
writeback, automatic export, and catalog synchronization run only when the resource's effective
agent matches the connection owner. The app owns only:

- `AgentEval_TestSuite` — editable suite metadata and up to 120 test cases, including business acceptance conditions and newline-separated provenance URLs
- `AgentEval_Report` — read-only suite-run summary and case results
- `AgentEval_DataAgents` — the single Data Agent that owns the spreadsheet
- `AgentEval_Suites` — suites that use only that owning Data Agent

The app clears and rewrites those fixed tabs while preserving their sheet IDs. Mixed-agent suites
and imports or exports targeting a different agent are rejected server-side. It does not modify
user-created tabs. Imported values are validated server-side; hidden columns and pasted data are
not trusted.

## Storage

The primary-storage abstraction supports:

- **Local JSON** — single-workstation development
- **Google Cloud Storage** — portable shared system data under a configured bucket and prefix

Local startup also recommends GCS as the intended primary destination. Until a bucket is
configured, the app remains available on a temporary local fallback and opens the settings flow
with GCS selected. Testing a destination shows the registered object count, size, latest updates,
and representative records before settings are saved or data is copied.

GCS writes use generation preconditions so stale clients cannot silently overwrite newer objects.
Migration validates and copies data before switching; it does not delete the source.

## Security model

### MCP coding-agent integration

Settings can issue a dedicated, expiring token for external coding agents. Connect a Streamable
HTTP MCP client to `http://127.0.0.1:4318/mcp` and send the token as an
`Authorization: Bearer ...` header. The plaintext token is shown only once; PrismTrail stores only
its SHA-256 digest, prefix, fingerprint, scopes, expiry, revocation state, and last-used time in a
local credential file that is not copied during primary-storage migration.

The 42 MCP tools cover suite and test-case listing, creation, history, bulk paste, and
optimistic-concurrency updates; Data Agent registration and connection checks; single-prompt and
suite execution; run evidence; report polling and case/report PDF downloads; GCS knowledge
registration, upload, sync, search, and planning; Google Sheets connection, import, and export; AI
suite editing; and storage inspection/switching. Storage switching requires its own elevated scope
plus a five-minute, token-bound preview confirmation. Source data is never deleted. Delete, purge,
run-cancel, arbitrary HTTP, and shell tools are intentionally not registered.

MCP `connect_google_sheet` requires `spreadsheetUrl`, the PrismTrail-managed `sheetName`, and the registered local `agentId`.
Listing, checking, suite import/export, and report export enforce the same agent isolation rules as
the UI and REST API.

To connect Cursor, set the issued token in `PRISMTRAIL_MCP_TOKEN` and paste the generated JSON into
the project-level `.cursor/mcp.json` or global `~/.cursor/mcp.json`. Verify the connection with
`cursor-agent mcp list-tools prismtrail`.

The MCP endpoint and token-management UI follow the same local-workstation boundary as the rest of
PrismTrail. Do not expose the Docker port to an untrusted network. A remote deployment must add TLS
and authentication/authorization for **all** `/api` routes, not only `/mcp`; otherwise callers could
bypass MCP policy through the existing local UI API.

This is a trusted-local-tool architecture:

- the HTTP service has no application-level user authentication
- Docker publishes only to `127.0.0.1` by default
- ADC is mounted read-only and tokens remain in process memory
- runtime data, `.env`, traces, spreadsheet connections, and screenshots are git-ignored
- request bodies are bounded and identifiers are validated
- security headers and a restrictive Content Security Policy are enabled

Do not expose the service to a LAN or the public internet as-is. A hosted deployment needs an
identity-aware proxy or application authentication, TLS, Workload Identity, authorization, and
appropriate tenancy controls. See [SECURITY.md](./SECURITY.md).

## Development

```bash
npm ci
npm test
npm audit --omit=dev --audit-level=high
npm start
```

Build the production image:

```bash
docker compose build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for pull requests and validation expectations.

## Community and support

- Ask setup questions and discuss ideas in [GitHub Discussions](https://github.com/ENOSTECH-inc/prismtrail/discussions).
- Report reproducible bugs or propose features with the [issue forms](https://github.com/ENOSTECH-inc/prismtrail/issues/new/choose).
- Read [SUPPORT.md](./SUPPORT.md), [CONTRIBUTING.md](./CONTRIBUTING.md), and the [Code of Conduct](./CODE_OF_CONDUCT.md).
- Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## Project structure

```text
bin/                 setup and diagnostic CLI
lib/                 Google Cloud, evaluation, storage, and Sheets modules
public/              dependency-free web UI
skills/              bundled coding-agent skill
test/                Node.js unit tests
server.mjs           local HTTP API and orchestration
compose.yaml         loopback-only Docker Compose setup
```

## Related projects and design influences

This implementation is specialized for BigQuery Data Agents. Its product vocabulary and
documentation structure were informed by established evaluation projects:

- [promptfoo](https://github.com/promptfoo/promptfoo) — configuration-driven evals, red teaming,
  and shareable results
- [DeepEval](https://github.com/confident-ai/deepeval) — unit-test framing and LLM-as-a-judge
  metrics
- [Arize Phoenix](https://github.com/Arize-ai/phoenix) — traces, experiments, evaluation, and
  observability

No source code from those projects is included.

## License

Apache License 2.0. See [LICENSE](./LICENSE), [NOTICE](./NOTICE), and
[third-party notices](./THIRD_PARTY_NOTICES.md).

Copyright 2026 ENOSTECH, Inc.
