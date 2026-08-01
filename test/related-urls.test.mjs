import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RELATED_URLS, normalizeRelatedUrls } from "../lib/related-urls.mjs";

test("normalizes and de-duplicates HTTP(S) related URLs", () => {
  assert.deepEqual(
    normalizeRelatedUrls([
      " https://example.com/slack/thread-1 ",
      "https://example.com/slack/thread-1",
      "http://localhost:3000/tickets/42"
    ]),
    ["https://example.com/slack/thread-1", "http://localhost:3000/tickets/42"]
  );
  assert.deepEqual(
    normalizeRelatedUrls("https://example.com/a\n\nhttps://example.com/b"),
    ["https://example.com/a", "https://example.com/b"]
  );
});

test("rejects unsafe, malformed, and oversized related URL lists", () => {
  assert.throws(() => normalizeRelatedUrls(["javascript:alert(1)"]), /httpまたはhttps/);
  assert.throws(() => normalizeRelatedUrls(["not-a-url"]), /形式が正しくありません/);
  assert.throws(() => normalizeRelatedUrls(["https://user:secret@example.com/source"]), /ユーザー名やパスワード/);
  assert.throws(() => normalizeRelatedUrls(["https://example.com/\tsecret"]), /制御文字/);
  assert.throws(
    () => normalizeRelatedUrls(Array.from({ length: MAX_RELATED_URLS + 1 }, (_, index) => `https://example.com/${index}`)),
    /最大20件/
  );
});
