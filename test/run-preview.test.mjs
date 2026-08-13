import assert from "node:assert/strict";
import test from "node:test";
import { extractChartPreview, renderChartPreviewSvg } from "../lib/run-preview.mjs";

test("extracts and renders an inline Agent response chart", async () => {
  const chart = extractChartPreview({
    events: [
      {
        kind: "chart.result",
        payload: {
          vegaConfig: {
            mark: "bar",
            title: "月次売上",
            data: { values: [{ month: "4月", sales: 10 }, { month: "5月", sales: 14 }] },
            encoding: {
              x: { field: "month", type: "nominal" },
              y: { field: "sales", type: "quantitative" }
            }
          }
        }
      }
    ]
  });

  assert.equal(chart.count, 1);
  assert.deepEqual(chart.marks, ["bar"]);
  assert.deepEqual(chart.titles, ["月次売上"]);
  const svg = await renderChartPreviewSvg(chart, { width: 480, height: 220 });
  assert.match(svg, /^<svg/);
  assert.match(svg, /<path|<rect/);
  assert.doesNotMatch(svg, /<text\b/);

  const htmlSvg = await renderChartPreviewSvg(chart, { width: 480, height: 220, stripText: false });
  assert.match(htmlSvg, /<text\b/);
  assert.match(htmlSvg, /月次売上/);
  assert.match(htmlSvg, /4月/);
  assert.match(htmlSvg, /month/);
  assert.match(htmlSvg, /sales/);
});

test("does not fetch external chart data while exporting a report", async () => {
  const svg = await renderChartPreviewSvg({
    specs: [{ mark: "line", data: { url: "https://example.com/data.json" } }]
  });
  assert.equal(svg, "");
});
