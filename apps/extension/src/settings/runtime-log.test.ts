import test from "node:test";
import assert from "node:assert/strict";
import { appendRuntimeLog, clearRuntimeLogs, readRuntimeLogs, type RuntimeLogStorage } from "./runtime-log.js";

test("runtime log stores newest entries first and caps history", async () => {
  const storage = fakeStorage();
  for (let i = 0; i < 105; i += 1) await appendRuntimeLog({ level: "info", source: "content", message: `event ${i}` }, storage);

  const logs = await readRuntimeLogs(storage);

  assert.equal(logs.length, 100);
  assert.equal(logs[0]?.message, "event 104");
  assert.equal(logs.at(-1)?.message, "event 5");
  assert.equal(typeof logs[0]?.ts, "number");
});

test("runtime log can be cleared", async () => {
  const storage = fakeStorage();
  await appendRuntimeLog({ level: "error", source: "backend", message: "failed" }, storage);
  await clearRuntimeLogs(storage);

  assert.deepEqual(await readRuntimeLogs(storage), []);
});

function fakeStorage(): RuntimeLogStorage & { value: Record<string, unknown> } {
  return {
    value: {},
    async get() { return this.value; },
    async set(value: Record<string, unknown>) { this.value = { ...this.value, ...value }; },
  };
}
