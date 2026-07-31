import test from "node:test";
import assert from "node:assert/strict";
import { createAsyncMutex, createKeyedAsyncMutex, mapWithConcurrency } from "../lib/concurrency.mjs";

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

test("createKeyedAsyncMutex serializes the same key and allows different keys in parallel", async () => {
  const withKeyedLock = createKeyedAsyncMutex();
  const order = [];
  let overlappingDifferentKeys = false;
  let sheetA = false;
  let sheetB = false;

  await Promise.all([
    withKeyedLock("sheet-a", async () => {
      sheetA = true;
      if (sheetB) overlappingDifferentKeys = true;
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("a-end");
      sheetA = false;
    }),
    withKeyedLock("sheet-a", async () => {
      order.push("a2-start");
      order.push("a2-end");
    }),
    withKeyedLock("sheet-b", async () => {
      sheetB = true;
      if (sheetA) overlappingDifferentKeys = true;
      order.push("b-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("b-end");
      sheetB = false;
    })
  ]);

  const aStart = order.indexOf("a-start");
  const aEnd = order.indexOf("a-end");
  const a2Start = order.indexOf("a2-start");
  assert.ok(aStart < aEnd && aEnd < a2Start);
  assert.equal(overlappingDifferentKeys, true);
});

test("mapWithConcurrency stops claiming work after abort", async () => {
  const controller = new AbortController();
  const started = [];
  const results = await mapWithConcurrency(
    [1, 2, 3, 4, 5, 6],
    2,
    async (value) => {
      started.push(value);
      if (started.length >= 2) controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return value;
    },
    { signal: controller.signal }
  );
  assert.ok(started.length < 6);
  assert.equal(results.filter((value) => value !== undefined).length, started.length);
});
