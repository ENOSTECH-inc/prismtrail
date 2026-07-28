# Contributing

Thank you for improving PrismTrail.

## Development setup

```bash
npm ci
npm run setup -- doctor
npm test
```

Use a non-production Google Cloud project for live integration testing. Never commit `.env`,
runtime `data/`, traces, credentials, spreadsheet IDs, bucket names, or customer data.

## Pull requests

1. Create a focused branch.
2. Keep changes small enough to review.
3. Add or update tests for behavioral changes.
4. Run:

   ```bash
   npm test
   npm audit --omit=dev --audit-level=high
   docker compose build
   ```

5. Describe the user impact, security impact, tests performed, and any live integration test that
   was intentionally skipped.

Changes to evaluation semantics, persistence, authentication, GCS writes, Google Sheets imports,
or network binding require extra review.

## Coding guidelines

- Use Node.js built-ins and existing dependencies where practical.
- Validate untrusted values on the server.
- Escape all untrusted browser-rendered text.
- Keep access tokens in memory and out of logs, responses, and persistent storage.
- Preserve backward compatibility for stored schemas and managed Google Sheet formats.
- Do not silently perform cloud writes; keep them tied to explicit user actions.

## License

By contributing, you agree that your contributions are licensed under Apache License 2.0.
