import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PageChangeObserver } from "./page-change-observer.js";

test("PageChangeObserver schedules when manga nodes are appended", async () => {
  const dom = new JSDOM(`<body><main id="reader"></main></body>`, { url: "https://example.test" });
  installDom(dom);
  const reasons: string[] = [];
  const observer = new PageChangeObserver(document, { onChange: (reason: string) => reasons.push(reason), debounceMs: 0 });
  observer.start();

  document.querySelector("#reader")!.append(document.createElement("img"));
  await tick();

  assert.equal(reasons.includes("mutation"), true);
  observer.stop();
});

test("PageChangeObserver schedules on captured image load", async () => {
  const dom = new JSDOM(`<body><img id="page" /></body>`, { url: "https://example.test" });
  installDom(dom);
  const reasons: string[] = [];
  const observer = new PageChangeObserver(document, { onChange: (reason: string) => reasons.push(reason), debounceMs: 0 });
  observer.start();

  document.querySelector("#page")!.dispatchEvent(new dom.window.Event("load", { bubbles: false }));
  await tick();

  assert.equal(reasons.includes("image-load"), true);
  observer.stop();
});

function installDom(dom: JSDOM): void {
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.MutationObserver = dom.window.MutationObserver;
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}