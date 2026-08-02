import test from "node:test";
import assert from "node:assert/strict";
import type { SurfaceTask } from "@umt/shared/types";
import { DirectClient } from "./direct-client.js";
import type { ExtensionSettings } from "../../settings/settings.js";
import { DEFAULT_SETTINGS } from "../../settings/settings.js";
import { DirectOcrCache } from "../cache/direct-ocr-cache.js";
import type { RecognitionTileCropper } from "../capture/recognition-tile-cropper.js";

function task(overrides: Partial<SurfaceTask> = {}): SurfaceTask {
  return {
    surfaceId: "s1",
    pageUrl: "https://manga.example/chapter/1",
    domain: "manga.example",
    imageData: "data:image/jpeg;base64,aW1hZ2U=",
    viewportPriority: "p0",
    surfaceRect: { x: 0, y: 0, width: 100, height: 100 },
    naturalSize: { width: 100, height: 100 },
    renderSize: { width: 100, height: 100 },
    readingDirection: "auto",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    ...overrides,
  };
}

function settings(fetchImpl: typeof fetch): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: {
      ...DEFAULT_SETTINGS.directOcr,
      apiUrl: "https://ocr.example/ocr",
      apiKeys: ["ocr-key"],
    },
    directTranslator: {
      baseUrl: "https://api.example/v1",
      apiKey: "llm-key",
      model: "gpt-test",
    },
    targetLanguage: "zh-CN",
    translationModel: "gpt-test",
    __testFetch: fetchImpl,
  } as ExtensionSettings & { __testFetch: typeof fetch };
}

function settingsWithCache(fetchImpl: typeof fetch, cache: DirectOcrCache): ExtensionSettings {
  return { ...settings(fetchImpl), __testOcrCache: cache } as ExtensionSettings & { __testFetch: typeof fetch; __testOcrCache: DirectOcrCache };
}

function settingsWithTileCropper(fetchImpl: typeof fetch, cropper: RecognitionTileCropper, maxOcrCalls = DEFAULT_SETTINGS.directOcr.maxAutoOcrPages): ExtensionSettings {
  const base = settings(fetchImpl);
  return {
    ...base,
    directOcr: { ...base.directOcr, maxAutoOcrPages: maxOcrCalls },
    __testRecognitionTileCropper: cropper,
  } as ExtensionSettings & { __testFetch: typeof fetch; __testRecognitionTileCropper: RecognitionTileCropper };
}

test("DirectClient submits imageData through OCR and translator", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("ocr")) {
      const auth = new Headers(init?.headers).get("authorization");
      assert.equal(auth, "Bearer ocr-key");
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const auth = new Headers(init?.headers).get("authorization");
    assert.equal(auth, "Bearer llm-key");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settings(fetchImpl));

  const response = await client.submit(task(), "job-1");

  assert.equal(response.ok, true);
  assert.equal(response.surfaceId, "s1");
  assert.equal(response.status, "completed");
  assert.equal(response.result?.regions[0]?.translatedText, "你好");
  assert.equal(response.result?.regions[0]?.box.x, 10);
  assert.deepEqual(calls, ["https://ocr.example/ocr", "https://api.example/v1/chat/completions"]);
});

test("DirectClient sends user glossary to translator and includes glossary version in profile", async () => {
  let translatorPrompt = "";
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      return new Response(JSON.stringify({ words_result: [{ words: "Clark came from Murim", location: { left: 10, top: 20, width: 160, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    translatorPrompt = body.messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"克拉克来自武林"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient({
    ...settings(fetchImpl),
    glossaryText: "Clark = 克拉克\nMurim = 武林",
  } as ReturnType<typeof settings>);

  const response = await client.submit(task(), "job-1");

  assert.equal(response.ok, true);
  assert.match(translatorPrompt, /Clark/);
  assert.match(translatorPrompt, /克拉克/);
  assert.match(translatorPrompt, /Murim/);
  assert.match(translatorPrompt, /武林/);
  assert.match(client.providerProfile(), /glossary:[a-f0-9]{16}/);
  assert.match(response.ok ? response.result?.providerProfile ?? "" : "", /glossary:[a-f0-9]{16}/);
});

test("DirectClient rejects tasks without imageData with a clear error", async () => {
  const client = new DirectClient(settings((async () => { throw new Error("must not fetch"); }) as typeof fetch));

  const noImageTask = task();
  delete noImageTask.imageData;
  const response = await client.submit(noImageTask);

  assert.equal(response.ok, false);
  assert.match(response.error, /imageData.*required/i);
});

test("DirectClient rejects remote plain HTTP API URLs before sending secrets", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new Error("must not fetch insecure API URLs");
  }) as typeof fetch;
  const configured = {
    ...settings(fetchImpl),
    directOcr: { ...settings(fetchImpl).directOcr, apiUrl: "http://ocr.example/ocr" },
  } as ReturnType<typeof settings>;
  const client = new DirectClient(configured);

  const response = await client.submit(task());

  assert.equal(response.ok, false);
  assert.match(response.error, /OCR API URL rejected/i);
  assert.match(response.error, /https/);
  assert.equal(calls, 0);
});

test("DirectClient selfTest reports missing configuration", async () => {
  const client = new DirectClient({ ...DEFAULT_SETTINGS, runMode: "direct" });

  const response = await client.selfTest();

  assert.equal(response.ok, true);
  assert.equal(response.steps.some((step: { name: string; ok: boolean }) => step.name === "ocr-config" && !step.ok), true);
  assert.equal(response.steps.some((step: { name: string; ok: boolean }) => step.name === "translator-config" && !step.ok), true);
});

test("DirectClient reuses OCR cache when retranslating the same image", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  await client.submit(task());
  await client.retranslate(task());

  assert.equal(ocrCalls, 1);
  assert.equal(translatorCalls, 2);
  assert.equal((await client.cacheStats()).ok, true);
});

test("DirectClient clearCache clears direct OCR cache entries", async () => {
  const cache = new DirectOcrCache(fakeStorage());
  await cache.set("key", [{
    id: "r1",
    box: { x: 1, y: 2, width: 3, height: 4 },
    sourceText: "HELLO",
    confidence: 1,
    orientation: "horizontal",
    kind: "dialogue",
  }]);
  const client = new DirectClient(settingsWithCache((async () => { throw new Error("must not fetch"); }) as typeof fetch, cache));

  const response = await client.clearCache();

  assert.equal(response.ok, true);
  assert.equal(response.ok && response.deleted, 1);
});


test("DirectClient persists manual overrides and applies them to later cached results", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const storage = fakeStorage();
  const cache = new DirectOcrCache(storage);
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"原始翻译"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const first = new DirectClient({ ...settingsWithCache(fetchImpl, cache), __testManualOverrideStorage: storage } as ExtensionSettings & { __testFetch: typeof fetch; __testOcrCache: DirectOcrCache; __testManualOverrideStorage: ReturnType<typeof fakeStorage> });
  const firstResponse = await first.submit(task());
  assert.equal(firstResponse.ok && firstResponse.result?.regions[0]?.translatedText, "原始翻译");
  const imageHash = firstResponse.ok ? firstResponse.result!.imageHash : "";

  await first.saveManualOverride({ imageHash, targetLanguage: "zh-CN", regionId: "network-ocr-1", translatedText: "人工修正" });

  const second = new DirectClient({ ...settingsWithCache(fetchImpl, cache), __testManualOverrideStorage: storage } as ExtensionSettings & { __testFetch: typeof fetch; __testOcrCache: DirectOcrCache; __testManualOverrideStorage: ReturnType<typeof fakeStorage> });
  const secondResponse = await second.submit(task());

  assert.equal(secondResponse.ok, true);
  assert.equal(secondResponse.ok && secondResponse.result?.regions[0]?.translatedText, "人工修正");
  assert.equal(ocrCalls, 1);
  assert.equal(translatorCalls, 2);
});
function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    async get(key?: unknown) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}

test("DirectClient exposes OCR provider errors in submit response", async () => {
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      return new Response(JSON.stringify({ error: "INSUFFICIENT_CREDITS", message: "账户积分不足" }), { status: 402, headers: { "content-type": "application/json" } });
    }
    throw new Error("translator should not be called when OCR fails");
  }) as typeof fetch;
  const client = new DirectClient(settings(fetchImpl));

  const response = await client.submit(task());

  assert.equal(response.ok, false);
  assert.match(response.error, /Network OCR failed: 402/);
  assert.match(response.error, /INSUFFICIENT_CREDITS/);
  assert.match(response.error, /账户积分不足/);
});


// RED: OCR stability/cost protection tests added before implementation.
test("DirectClient coalesces concurrent OCR requests for the same image", async () => {
  let ocrCalls = 0;
  let releaseOcr!: () => void;
  const ocrGate = new Promise<void>((resolve) => { releaseOcr = resolve; });
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      await ocrGate;
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  const first = client.submit(task({ surfaceId: "s1" }));
  const second = client.submit(task({ surfaceId: "s2" }));
  await Promise.resolve();
  releaseOcr();
  const responses = await Promise.all([first, second]);

  assert.equal(responses.every((response) => response.ok), true);
  assert.equal(ocrCalls, 1);
});

test("DirectClient keeps OCR key status across submissions without exposing keys", async () => {
  const seenAuth: string[] = [];
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      seenAuth.push(auth);
      if (auth === "Bearer quota-key") {
        return new Response(JSON.stringify({ code: "INSUFFICIENT_CREDITS", message: "账户积分不足" }), { status: 402, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ words_result: [{ words: "HELLO", location: { left: 10, top: 20, width: 60, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"你好"}]}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const configured = {
    ...settings(fetchImpl),
    directOcr: { ...settings(fetchImpl).directOcr, apiKeys: ["quota-key", "fresh-key"] },
    retryCount: 1,
  } as ReturnType<typeof settings>;
  const client = new DirectClient(configured);

  const response = await client.submit(task());
  const status = await client.configStatus();

  assert.equal(response.ok, true);
  assert.deepEqual(seenAuth, ["Bearer quota-key", "Bearer fresh-key"]);
  assert.equal(status.ok, true);
  assert.equal(status.ok && status.ocr?.keyPool?.count, 2);
  assert.equal(status.ok && status.ocr?.keyPool?.available, 1);
  const text = JSON.stringify(status);
  assert.match(text, /key#1/);
  assert.match(text, /key#2/);
  assert.equal(text.includes("quota-key"), false);
  assert.equal(text.includes("fresh-key"), false);
});

test("DirectClient carries previous chapter translations into later page prompts", async () => {
  const prompts: string[] = [];
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      return new Response(JSON.stringify({ words_result: [{ words: "Clark is here", location: { left: 10, top: 20, width: 120, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    prompts.push(body.messages[0].content);
    const translatedText = prompts.length === 1 ? "克拉克来了" : "克拉克回来了";
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "network-ocr-1", translatedText }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  await client.submit(task({ surfaceId: "s1", imageData: "data:image/jpeg;base64,aW1hZ2Ux" }));
  await client.submit(task({ surfaceId: "s2", imageData: "data:image/jpeg;base64,aW1hZ2Uy" }));

  assert.match(prompts[1] ?? "", /Chapter context/i);
  assert.match(prompts[1] ?? "", /克拉克来了/);
});

test("DirectClient sends previous page translation when retranslating", async () => {
  const prompts: string[] = [];
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      return new Response(JSON.stringify({ words_result: [{ words: "I will return", location: { left: 10, top: 20, width: 120, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    prompts.push(body.messages[0].content);
    const translatedText = prompts.length === 1 ? "我会回来的" : "我还会回来";
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "network-ocr-1", translatedText }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  await client.submit(task());
  await client.retranslate(task());

  assert.match(prompts[1] ?? "", /Previous translations/i);
  assert.match(prompts[1] ?? "", /我会回来的/);
  assert.match(prompts[1] ?? "", /retranslation/i);
});

test("DirectClient provider profile includes translation style version for text cache invalidation", async () => {
  const client = new DirectClient(settings((async () => { throw new Error("must not fetch"); }) as typeof fetch));

  assert.match(client.providerProfile(), /style:manga-v\d+/);
});

test("DirectClient provider profile changes when OCR endpoint or mapping changes", async () => {
  const fetchImpl = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
  const base = settings(fetchImpl);
  const endpointChanged = {
    ...base,
    directOcr: { ...base.directOcr, apiUrl: "https://other-ocr.example/ocr" },
  };
  const mappingChanged = {
    ...base,
    directOcr: { ...base.directOcr, regionsPaths: ["data.items"] },
  };

  const baseProfile = new DirectClient(base).providerProfile();

  assert.match(baseProfile, /direct:image_base64:ocr:[a-f0-9]{8}/);
  assert.notEqual(new DirectClient(endpointChanged).providerProfile(), baseProfile);
  assert.notEqual(new DirectClient(mappingChanged).providerProfile(), baseProfile);
});

test("DirectClient carries remembered term candidates into later prompts", async () => {
  const prompts: string[] = [];
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      const text = prompts.length === 0 ? "Heavenly Demon meets Clark" : "he returns";
      return new Response(JSON.stringify({ words_result: [{ words: text, location: { left: 10, top: 20, width: 180, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    prompts.push(body.messages[0].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "network-ocr-1", translatedText: "天魔" }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  await client.submit(task({ surfaceId: "s1", imageData: "data:image/jpeg;base64,dGVybXMx" }));
  await client.submit(task({ surfaceId: "s2", imageData: "data:image/jpeg;base64,dGVybXMy" }));

  assert.match(prompts[1] ?? "", /Auto-detected term candidates/i);
  assert.match(prompts[1] ?? "", /Heavenly Demon/);
  assert.match(prompts[1] ?? "", /Clark/);
});


test("DirectClient uses saved manual override as previous translation guidance on retranslate", async () => {
  const prompts: string[] = [];
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      return new Response(JSON.stringify({ words_result: [{ words: "I will return", location: { left: 10, top: 20, width: 120, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    prompts.push(body.messages[0].content);
    const translatedText = prompts.length === 1 ? "我将返回" : "我会回来的";
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "network-ocr-1", translatedText }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  const first = await client.submit(task());
  assert.equal(first.ok, true);
  await client.saveManualOverride({ imageHash: first.ok ? first.result!.imageHash : "", targetLanguage: "zh-CN", regionId: "network-ocr-1", translatedText: "我一定会回来的" });
  await client.retranslate(task());

  assert.match(prompts[1] ?? "", /Previous translations/i);
  assert.match(prompts[1] ?? "", /我一定会回来的/);
  assert.doesNotMatch(prompts[1] ?? "", /我将返回/);
});

test("DirectClient excludes deleted manual overrides from retranslate guidance", async () => {
  const prompts: string[] = [];
  const cache = new DirectOcrCache(fakeStorage());
  const fetchImpl = (async (url, init) => {
    if (String(url).includes("ocr")) {
      return new Response(JSON.stringify({ words_result: [{ words: "Do not translate this", location: { left: 10, top: 20, width: 150, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    prompts.push(body.messages[0].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "network-ocr-1", translatedText: "不要翻译这个" }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithCache(fetchImpl, cache));

  const first = await client.submit(task());
  assert.equal(first.ok, true);
  await client.saveManualOverride({ imageHash: first.ok ? first.result!.imageHash : "", targetLanguage: "zh-CN", regionId: "network-ocr-1", translatedText: "" });
  await client.retranslate(task());

  assert.doesNotMatch(prompts[1] ?? "", /Previous translations/);
  assert.doesNotMatch(prompts[1] ?? "", /不要翻译这个/);
});

test("DirectClient sends tall images through multiple ordered OCR tiles and one translation", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const croppedYs: number[] = [];
  const cropper: RecognitionTileCropper = async (_imageData, units) => units.map((unit, index) => {
    croppedYs.push(unit.crop.y);
    return {
      unit,
      imageData: `data:image/png;base64,${index % 2 === 0 ? "AQ==" : "Ag=="}`,
      imageBytes: new Uint8Array([index + 1]),
      mimeType: "image/png",
    };
  });
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({
        words_result: [{ words: `TILE ${ocrCalls}`, location: { left: 10, top: 20, width: 80, height: 20 } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithTileCropper(fetchImpl, cropper));

  const response = await client.submit(task({ naturalSize: { width: 1000, height: 16000 }, renderSize: { width: 1000, height: 16000 } }));

  assert.equal(response.ok, true);
  assert.equal(ocrCalls > 1, true);
  assert.equal(translatorCalls, 1);
  assert.equal(croppedYs[0], 0);
  assert.deepEqual(croppedYs, [...croppedYs].sort((a, b) => a - b));
  const diagnostics = await client.recentDiagnostics();
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.ok && Number(diagnostics.records[0]?.tileCount) > 1, true);
  assert.equal(JSON.stringify(diagnostics).includes("imageData"), false);
});

test("DirectClient keeps short images on one OCR request without invoking the tile cropper", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({ words_result: [{ words: "SHORT", location: { left: 10, top: 20, width: 80, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const cropper: RecognitionTileCropper = async () => {
    throw new Error("short images must not be cropped");
  };
  const client = new DirectClient(settingsWithTileCropper(fetchImpl, cropper));

  const response = await client.submit(task({ naturalSize: { width: 1000, height: 6000 }, renderSize: { width: 1000, height: 6000 } }));

  assert.equal(response.ok, true);
  assert.equal(ocrCalls, 1);
  assert.equal(translatorCalls, 1);
});

test("DirectClient keeps a tall image whole when the OCR call cap is one", async () => {
  let ocrCalls = 0;
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({ words_result: [{ words: "WHOLE", location: { left: 10, top: 20, width: 80, height: 20 } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const cropper: RecognitionTileCropper = async () => {
    throw new Error("cap=1 must preserve whole-image OCR");
  };
  const client = new DirectClient(settingsWithTileCropper(fetchImpl, cropper, 1));

  const response = await client.submit(task({ naturalSize: { width: 1000, height: 16000 }, renderSize: { width: 1000, height: 16000 } }));

  assert.equal(response.ok, true);
  assert.equal(ocrCalls, 1);
});
