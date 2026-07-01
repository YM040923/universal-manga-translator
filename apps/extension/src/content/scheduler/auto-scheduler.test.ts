import test from "node:test";
import assert from "node:assert/strict";
import { AutoScheduler } from "./auto-scheduler.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("AutoScheduler debounces multiple run requests", async () => {
  let count = 0;
  const scheduler = new AutoScheduler(() => { count += 1; }, 20);
  scheduler.requestRun("load");
  scheduler.requestRun("scroll");
  scheduler.requestRun("scroll");
  await wait(60);
  assert.equal(count, 1);
});

test("AutoScheduler does not run while paused and resumes later", async () => {
  let count = 0;
  const scheduler = new AutoScheduler(() => { count += 1; }, 10);
  scheduler.pause();
  scheduler.requestRun("scroll");
  await wait(30);
  assert.equal(count, 0);
  scheduler.resume();
  scheduler.requestRun("resume");
  await wait(30);
  assert.equal(count, 1);
});


test("AutoScheduler queues one follow-up run instead of overlapping", async () => {
  let active = 0;
  let maxActive = 0;
  let count = 0;
  const scheduler = new AutoScheduler(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    count += 1;
    await wait(40);
    active -= 1;
  }, 5);

  scheduler.requestRun("load");
  await wait(10);
  scheduler.requestRun("scroll");
  scheduler.requestRun("mutation");
  await wait(120);

  assert.equal(maxActive, 1);
  assert.equal(count, 2);
});
