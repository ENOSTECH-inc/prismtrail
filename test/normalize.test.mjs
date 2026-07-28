import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMessages, summarizeRun } from "../lib/normalize.mjs";

test("normalizes core Conversational Analytics message types", () => {
  const events = normalizeMessages([
    { systemMessage: { groupId: 1, text: { parts: ["Working"], textType: "PROGRESS" } } },
    { systemMessage: { groupId: 1, data: { generatedSql: "SELECT 1" } } },
    {
      systemMessage: {
        groupId: 1,
        data: { bigQueryJob: { projectId: "demo", jobId: "job1", location: "US" } }
      }
    },
    { systemMessage: { groupId: 1, chart: { result: { vegaConfig: { mark: "bar" } } } } },
    { systemMessage: { groupId: 1, text: { parts: ["Done"], textType: "FINAL_RESPONSE" } } }
  ]);

  assert.deepEqual(
    events.map((event) => event.kind),
    [
      "text.progress",
      "data.generated_sql",
      "data.big_query_job",
      "chart.result",
      "text.final_response"
    ]
  );
  assert.equal(events[1].payload, "SELECT 1");
});

test("summarizes successful runs and BigQuery usage", () => {
  const events = normalizeMessages([
    { systemMessage: { data: { generatedSql: "SELECT 1" } } },
    { systemMessage: { text: { parts: ["Done"], textType: "FINAL_RESPONSE" } } }
  ]);
  const summary = summarizeRun(
    events,
    [
      {
        statistics: {
          query: {
            totalBytesProcessed: "100",
            totalBytesBilled: "200",
            totalSlotMs: "300"
          }
        }
      }
    ],
    1234
  );

  assert.equal(summary.status, "passed");
  assert.equal(summary.sqlCount, 1);
  assert.equal(summary.totalBytesProcessed, 100);
  assert.equal(summary.durationMs, 1234);
});

test("counts a verified matched query as SQL evidence", () => {
  const events = normalizeMessages([
    {
      systemMessage: {
        data: {
          matchedQuery: {
            exampleQuery: {
              naturalLanguageQuestion: "Find customers",
              sqlQuery: "SELECT customer_id FROM customers"
            }
          }
        }
      }
    },
    {
      systemMessage: {
        data: { bigQueryJob: { projectId: "demo", jobId: "job1", location: "US" } }
      }
    },
    { systemMessage: { text: { parts: ["Done"], textType: "FINAL_RESPONSE" } } }
  ]);
  const summary = summarizeRun(events, [], 500);
  assert.equal(summary.sqlCount, 1);
  assert.equal(summary.jobCount, 0);
});

test("uses a BigQuery query job as SQL evidence when no SQL event is emitted", () => {
  const events = normalizeMessages([
    { systemMessage: { data: { bigQueryJob: { projectId: "demo", jobId: "job1" } } } },
    { systemMessage: { text: { parts: ["Done"], textType: "FINAL_RESPONSE" } } }
  ]);
  assert.equal(summarizeRun(events, [], 500).sqlCount, 1);
});
