import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { debounce, isUmtOwnedMutation, reclaimOrphanUmtNodes } from "./utils.js";

function useDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://manga.example" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
}

test("reclaimOrphanUmtNodes removes every overlay root left by a previous injection", () => {
  useDom();
  const host = document.createElement("div");
  for (const key of ["umtOverlayRoot", "umtPanel", "umtDebugRoot", "umtSelectionLayer"]) {
    const orphan = document.createElement("div");
    orphan.dataset[key] = "true";
    host.append(orphan);
  }
  const unrelated = document.createElement("div");
  unrelated.className = "page-artwork";
  document.body.append(host, unrelated);

  reclaimOrphanUmtNodes();

  assert.equal(host.children.length, 0);
  assert.ok(document.querySelector(".page-artwork"));
});

test("isUmtOwnedMutation recognises added overlay nodes and ignores page edits", () => {
  useDom();
  const overlay = document.createElement("div");
  overlay.dataset.umtOverlayRoot = "true";
  const artwork = document.createElement("img");

  const added = { target: document.body, addedNodes: [overlay], removedNodes: [] } as unknown as MutationRecord;
  const removed = { target: document.body, addedNodes: [], removedNodes: [artwork] } as unknown as MutationRecord;
  const nested = { target: artwork, addedNodes: [], removedNodes: [] } as unknown as MutationRecord;

  assert.equal(isUmtOwnedMutation(added), true);
  assert.equal(isUmtOwnedMutation(removed), false);
  assert.equal(isUmtOwnedMutation(nested), false);
});

test("debounced.cancel stops a pending invocation", async () => {
  useDom();
  let calls = 0;
  const debounced = debounce(() => { calls += 1; }, 5);

  debounced();
  debounced.cancel();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(calls, 0);
});

test("debounced collapses a burst into one trailing invocation", async () => {
  useDom();
  const seen: number[] = [];
  const debounced = debounce((value: number) => { seen.push(value); }, 5);

  debounced(1);
  debounced(2);
  debounced(3);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(seen, [3]);
});
