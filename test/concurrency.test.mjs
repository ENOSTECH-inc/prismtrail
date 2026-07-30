import test from "node:test";
import assert from "node:assert/strict";
import { createAsyncMutex, mapWithConcurrency } from "../lib/concurrency.mjs";

test("mapWithConcurrency respects the concurrency limit", async () => {
  let inflight = 0;
  let peak = 0;
  const started = [];
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
    inflight += 1;
    peak = Math.max(peak, inflight);
    started.push(value);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inflight -= 1;
    return value * 10;
  });
  assert.equal(peak, 3);
  assert.deepEqual(started.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test("mapWithConcurrency preserves result order", async () => {
  const results = await mapWithConcurrency(["a", "b", "c"], 2, async (value, index) => {
    await new Promise((resolve) => setTimeout(resolve, (2 - index) * 15));
    return `${value}-${index}`;
  });
  assert.deepEqual(results, ["a-0", "b-1", "c-2"]);
});

test("createAsyncMutex serializes critical sections", async () => {
  const withLock = createAsyncMutex();
  const order = [];
  await Promise.all([
    withLock(async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("a-end");
    }),
    withLock(async () => {
      order.push("b-start");
      order.push("b-end");
    })
  ]);
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});
