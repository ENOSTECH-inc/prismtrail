# Security Policy

## Supported versions

Security fixes are applied to the latest commit on the `main` branch and released from the latest
supported minor series.

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| Earlier development snapshots | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include the affected version or commit, reproduction steps, impact, and any suggested fix.

Please avoid including real access tokens, service-account keys, customer data, BigQuery results,
or other secrets in the report. We will acknowledge a valid report and coordinate remediation and
disclosure through the private advisory.

## Security boundary

PrismTrail is a trusted local workstation tool. It uses the current user's Google
Cloud Application Default Credentials and has no application-level user authentication.

The default Docker Compose configuration publishes the service only on `127.0.0.1`. Do not change
that binding or expose the service to an untrusted network without adding TLS, authentication,
authorization, request auditing, and workload identity.

The `/mcp` endpoint requires a dedicated bearer token, but this does not convert the rest of the
local application into an authenticated network service. Token administration is restricted to a
localhost Host by default. Remote deployments must protect every `/api` route at the same trusted
reverse-proxy boundary. MCP tokens are scoped, expiring, revocable, rate-limited, stored only as
hashes, and excluded from primary-storage migration. Delete tools are not part of the MCP allow-list.

## Sensitive data

The following files and values must never be committed:

- `.env`
- `data/` and evaluation traces
- Application Default Credentials and service-account keys
- access tokens
- production project, bucket, Data Agent, BigQuery job, and spreadsheet identifiers
- customer prompts, responses, expected values, and retrieved knowledge

If a secret is committed, revoke or rotate it immediately. Removing it from the latest commit is
not sufficient because Git history and forks may retain it.
