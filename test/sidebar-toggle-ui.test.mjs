import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("the full PrismTrail sidebar header toggles the navigation panel", () => {
  assert.match(app, /id="sidebar-toggle" class="sidebar-head-trigger"/);
  assert.match(app, /aria-controls="primary-sidebar-navigation"/);
  assert.match(app, /<nav id="primary-sidebar-navigation"/);
  assert.doesNotMatch(app, /<a class="brand" href="#\/suites"/);
});

test("the sidebar header trigger exposes hover and keyboard focus states", () => {
  assert.match(styles, /\.sidebar-head-trigger:hover/);
  assert.match(styles, /\.sidebar-head-trigger:focus-visible/);
  assert.match(styles, /\.sidebar-head-trigger:hover \.sidebar-toggle/);
});

test("the collapsed sidebar uses only the PrismTrail mark as its toggle", () => {
  assert.match(styles, /\.sidebar\.collapsed \.sidebar-toggle\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.sidebar\.collapsed \.brand\s*\{[^}]*justify-content:\s*center;/s);
});
