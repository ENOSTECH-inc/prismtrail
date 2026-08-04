import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("recent single-run entries are styled at their actual DOM nesting level", () => {
  assert.match(styles, /\.recent-panel #recent-runs-list > a\s*\{/);
  assert.match(styles, /\.recent-panel #recent-runs-list > a strong/);
  assert.doesNotMatch(styles, /\.recent-panel > a\s*\{/);
});

test("single-run history renders entries inside the recent-runs container", () => {
  assert.match(app, /<div id="recent-runs-list">\$\{recent\.map\(/);
  assert.match(app, /state\.runs\.filter\(\(run\) => agentRunMatches\(run, agent\)\)/);
  assert.match(app, /このAgentの最近の疎通テスト/);
});
