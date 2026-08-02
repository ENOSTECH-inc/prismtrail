import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAccuracySources,
  parseAccuracySourcesCell,
  resolveAccuracySources,
  serializeAccuracySources
} from "../lib/accuracy-sources.mjs";
import { validateReadOnlyBigQuerySql } from "../lib/google-cloud.mjs";
import { isPublicIpAddress, readPublicUrl } from "../lib/safe-url-reader.mjs";

test("accuracy sources normalize and round-trip all supported source types", () => {
  const sources = normalizeAccuracySources([
    { id: "a", type: "text", description: "manual", content: "65,200円" },
    { id: "b", type: "url", content: "https://example.com/evidence" },
    { id: "c", type: "bigquery_sql", content: "SELECT 65200 AS sales" }
  ]);
  assert.deepEqual(parseAccuracySourcesCell(serializeAccuracySources(sources)), sources);
  assert.throws(() => normalizeAccuracySources([{ type: "file", content: "/etc/passwd" }]), /種類/);
  assert.throws(() => normalizeAccuracySources([{ type: "url", content: "file:///etc/passwd" }]), /HTTP/);
});

test("accuracy source resolution keeps per-source failures auditable", async () => {
  const result = await resolveAccuracySources([
    { id: "text", type: "text", content: "truth" },
    { id: "url", type: "url", content: "https://example.com" },
    { id: "sql", type: "bigquery_sql", content: "SELECT 1" }
  ], {
    readUrl: async () => { throw new Error("blocked"); },
    executeBigQuery: async () => ({ projectId: "example-project", jobId: "job", totalBytesProcessed: 0, totalRows: 1, cacheHit: true, rows: [{ value: "1" }] })
  });
  assert.equal(result[0].status, "resolved");
  assert.equal(result[1].status, "error");
  assert.match(result[1].error, /blocked/);
  assert.deepEqual(JSON.parse(result[2].evidence), [{ value: "1" }]);
});

test("BigQuery accuracy SQL accepts reads and rejects scripts and mutations", () => {
  assert.equal(validateReadOnlyBigQuerySql("SELECT * FROM `p.d.t`"), "SELECT * FROM `p.d.t`");
  assert.equal(validateReadOnlyBigQuerySql("WITH x AS (SELECT 1) SELECT * FROM x;"), "WITH x AS (SELECT 1) SELECT * FROM x;");
  for (const sql of ["DELETE FROM `p.d.t` WHERE true", "SELECT 1; SELECT 2", "EXPORT DATA OPTIONS(uri='gs://bucket/x') AS SELECT 1", "SELECT * FROM EXTERNAL_QUERY('c', 'select 1')", "SELECT '/*'; DELETE FROM `p.d.t` WHERE true; SELECT '*/'"]) {
    assert.throws(() => validateReadOnlyBigQuerySql(sql));
  }
});

test("URL reader blocks private targets and revalidates redirects", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fd00::1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  await assert.rejects(
    readPublicUrl("https://example.com", { lookup: async () => [{ address: "127.0.0.1", family: 4 }] }),
    /公開IP/
  );
  let requestCount = 0;
  await assert.rejects(
    readPublicUrl("https://example.com/start", {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => {
        requestCount += 1;
        return {
          response: { statusCode: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } },
          body: Buffer.alloc(0),
          bytes: 0
        };
      }
    }),
    /ローカル・プライベート・予約済みIP/
  );
  assert.equal(requestCount, 1, "redirect target must be rejected before a second request");
  await assert.rejects(readPublicUrl("http://example.com:8080"), /標準HTTP/);
  await assert.rejects(readPublicUrl("http://2130706433"), /ローカル・プライベート・予約済みIP/);
});
