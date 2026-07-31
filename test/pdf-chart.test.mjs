import assert from "node:assert/strict";
import test from "node:test";
import { buildPieChartSvg, buildStackedBarSvg, pct, withCountPct } from "../lib/pdf-chart.mjs";

test("buildPieChartSvg renders donut paths for multiple slices", () => {
  const svg = buildPieChartSvg([
    { label: "Passed", value: 3, color: "#1f8a4c" },
    { label: "Failed", value: 1, color: "#c0392b" }
  ]);
  assert.match(svg, /<svg/);
  assert.match(svg, /#1f8a4c/);
  assert.match(svg, /#c0392b/);
  assert.match(svg, /path d=/);
});

test("buildStackedBarSvg and pct helpers", () => {
  const bar = buildStackedBarSvg([
    { value: 2, color: "#1f8a4c" },
    { value: 2, color: "#2c5aa0" }
  ]);
  assert.match(bar, /<rect/);
  assert.equal(pct(1, 4), "25%");
  assert.equal(withCountPct(1, 4), "1  (25%)");
});
