import assert from "node:assert/strict";
import { test } from "node:test";
import { workerBudget } from "./workerBudget.ts";

const GIB = 1024 ** 3;
test("correctness workers are bounded by CPU, memory and a small concurrency ceiling", () => {
  assert.equal(workerBudget(16, 32 * GIB), 4);
  assert.equal(workerBudget(2, 32 * GIB), 2);
  assert.equal(workerBudget(16, 5 * GIB), 2);
  for (const memory of [0, Number.NaN, GIB, 2 * GIB]) assert.equal(workerBudget(16, memory), 1);
  assert.equal(workerBudget(0, 32 * GIB), 1);
});
test("an explicit worker request can reduce concurrency without exceeding the budget", () => {
  assert.equal(workerBudget(16, 32 * GIB, "1"), 1);
  assert.equal(workerBudget(2, 32 * GIB, "8"), 2);
  for (const value of ["", "0", "-1", "2.5", "Infinity", "9007199254740992"]) {
    assert.throws(() => workerBudget(16, 32 * GIB, value), /positive integer/);
  }
});
