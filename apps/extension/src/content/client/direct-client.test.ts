import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOcrPreprocessVariantToUnit,
  planRecognitionUnits,
  type CoreOcrPreprocessLoader,
} from "@umt/core";
import type { SurfaceTask } from "@umt/shared/types";
import {
  DIRECT_OCR_MAX_TILE_HEIGHT,
  DIRECT_OCR_TILE_OVERLAP_RATIO,
  DirectClient,
} from "./direct-client.js";
import type { ExtensionSettings } from "../../settings/settings.js";
import { DEFAULT_SETTINGS } from "../../settings/settings.js";
import { DirectOcrCache } from "../cache/direct-ocr-cache.js";
import type { RecognitionTileCropper } from "../capture/recognition-tile-cropper.js";
import {
  createBrowserOcrTextEvidenceProvider,
  type OcrTextEvidencePixelInput,
} from "../capture/ocr-text-evidence.js";

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

function settingsWithTileCropper(fetchImpl: typeof fetch, cropper: RecognitionTileCropper, maxOcrTilesPerImage = DEFAULT_SETTINGS.directOcr.maxOcrTilesPerImage, maxAutoOcrPages = DEFAULT_SETTINGS.directOcr.maxAutoOcrPages): ExtensionSettings {
  const base = settings(fetchImpl);
  return {
    ...base,
    directOcr: { ...base.directOcr, maxAutoOcrPages, maxOcrTilesPerImage },
    __testRecognitionTileCropper: cropper,
  } as ExtensionSettings;
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
  const cropper: RecognitionTileCropper = async (_imageData, units, consume) => {
    for (const [index, unit] of units.entries()) {
      croppedYs.push(unit.crop.y);
      await consume({ unit, imageBytes: new Uint8Array([index + 1]), mimeType: "image/png" }, index, units.length);
    }
  };
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
  const signedSurfaceId = "surface:https://cdn.example/page.jpg?token=secret-token&X-Amz-Signature=secret-signature";

  const response = await client.submit(task({ surfaceId: signedSurfaceId, naturalSize: { width: 1000, height: 16000 }, renderSize: { width: 1000, height: 16000 } }));

  assert.equal(response.ok, true);
  assert.equal(ocrCalls > 1, true);
  assert.equal(translatorCalls, 1);
  assert.equal(croppedYs[0], 0);
  assert.deepEqual(croppedYs, [...croppedYs].sort((a, b) => a - b));
  const diagnostics = await client.recentDiagnostics();
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.ok && Number(diagnostics.records[0]?.tileCount) > 1, true);
  assert.match(String(diagnostics.ok ? diagnostics.records[0]?.imageId : ""), /^image:[a-f0-9]{12}$/);
  const diagnosticText = JSON.stringify(diagnostics);
  assert.equal(diagnosticText.includes("imageData"), false);
  assert.equal(diagnosticText.includes(signedSurfaceId), false);
  assert.equal(diagnosticText.includes("secret-token"), false);
  assert.equal(diagnosticText.includes("X-Amz-Signature"), false);
  assert.equal(diagnosticText.includes("secret-signature"), false);
});

test("DirectClient runs one bounded quality rescue and records safe diagnostics", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const variants: string[] = [];
  const preprocessLoader: CoreOcrPreprocessLoader = {
    withVariant: async (source, variant, consume) => {
      variants.push(variant.id);
      return consume({
        imageBytes: new Uint8Array([7]),
        fileName: `${variant.id}.png`,
        mimeType: "image/png",
        recognitionUnit: applyOcrPreprocessVariantToUnit(source.recognitionUnit, variant),
        ocrVariant: variant.id,
      });
    },
  };
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({
        words_result: [{
          words: ocrCalls === 1 ? "H3LL?" : "HELLO",
          score: ocrCalls === 1 ? 0.2 : 0.96,
          location: { left: 10, top: 20, width: 80, height: 20 },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"items":[{"id":"network-ocr-1","translatedText":"你好"}]}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const base = settings(fetchImpl);
  const client = new DirectClient({
    ...base,
    directOcr: { ...base.directOcr, maxOcrRescueCallsPerImage: 1 },
    __testOcrPreprocessLoader: preprocessLoader,
  } as ExtensionSettings & { __testOcrPreprocessLoader: CoreOcrPreprocessLoader });

  const response = await client.submit(task());

  assert.equal(response.ok, true);
  assert.equal(ocrCalls, 2);
  assert.equal(translatorCalls, 1);
  assert.deepEqual(variants, ["grayscale-contrast"]);
  assert.equal(response.ok ? response.result?.regions[0]?.sourceText : "", "HELLO");
  const diagnostics = await client.recentDiagnostics();
  const rescue = diagnostics.ok ? diagnostics.records.find((record) => record.type === "ocr-quality-rescue") : undefined;
  assert.equal(rescue?.usedBudget, 1);
  assert.equal(rescue?.remainingBudget, 0);
  assert.equal(rescue?.variant, "grayscale-contrast");
  assert.equal(rescue?.selected, "rescue");
  const diagnosticText = JSON.stringify(rescue);
  assert.equal(diagnosticText.includes("H3LL?"), false);
  assert.equal(diagnosticText.includes("HELLO"), false);
  assert.equal(diagnosticText.includes("data:image"), false);
  assert.equal(diagnosticText.includes("https://"), false);
});

test("DirectClient can rescue an empty manual selection but not an automatic empty image", async () => {
  for (const mode of ["manual", "automatic"] as const) {
    let ocrCalls = 0;
    const preprocessLoader: CoreOcrPreprocessLoader = {
      withVariant: async (source, variant, consume) => consume({
        imageBytes: new Uint8Array([8]),
        fileName: `${variant.id}.png`,
        mimeType: "image/png",
        recognitionUnit: applyOcrPreprocessVariantToUnit(source.recognitionUnit, variant),
        ocrVariant: variant.id,
      }),
    };
    const fetchImpl = (async (url) => {
      if (String(url).includes("ocr")) {
        ocrCalls += 1;
        return new Response(JSON.stringify({
          words_result: ocrCalls === 1 ? [] : [{
            words: "FOUND",
            score: 0.95,
            location: { left: 10, top: 20, width: 80, height: 20 },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const base = settings(fetchImpl);
    const client = new DirectClient({
      ...base,
      directOcr: { ...base.directOcr, maxOcrRescueCallsPerImage: 1 },
      __testOcrPreprocessLoader: preprocessLoader,
    } as ExtensionSettings & { __testOcrPreprocessLoader: CoreOcrPreprocessLoader });

    const response = await client.submit(task({ surfaceId: mode === "manual" ? "manual:selection-1" : "surface:auto" }));

    assert.equal(response.ok, true, mode);
    assert.equal(ocrCalls, mode === "manual" ? 2 : 1, mode);
  }
});

test("DirectClient rescues automatic empty OCR only when the injected evidence provider returns likely text", async () => {
  for (const likelyText of [true, false]) {
    let ocrCalls = 0;
    let evidenceCalls = 0;
    let preprocessCalls = 0;
    const preprocessLoader: CoreOcrPreprocessLoader = {
      withVariant: async (source, variant, consume) => {
        preprocessCalls += 1;
        return consume({
          imageBytes: new Uint8Array([8]),
          fileName: `${variant.id}.png`,
          mimeType: "image/png",
          recognitionUnit: applyOcrPreprocessVariantToUnit(source.recognitionUnit, variant),
          ocrVariant: variant.id,
        });
      },
    };
    const evidenceProvider = createBrowserOcrTextEvidenceProvider({
      readPixels: async (evidenceInput) => {
        evidenceCalls += 1;
        assert.equal(evidenceInput.imageBytes.byteLength > 0, true);
        assert.deepEqual(evidenceInput.imageSize, { width: 100, height: 100 });
        assert.equal(evidenceInput.recognitionUnit.reason, "automatic");
        return likelyText ? glyphEvidencePixels() : blankEvidencePixels();
      },
    });
    const fetchImpl = (async (url) => {
      if (String(url).includes("ocr")) {
        ocrCalls += 1;
        return new Response(JSON.stringify({
          words_result: ocrCalls === 1 ? [] : [{
            words: "FOUND",
            score: 0.95,
            location: { left: 10, top: 20, width: 80, height: 20 },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const base = settings(fetchImpl);
    const client = new DirectClient({
      ...base,
      directOcr: { ...base.directOcr, maxOcrRescueCallsPerImage: 1 },
      __testOcrPreprocessLoader: preprocessLoader,
    } as ExtensionSettings & { __testOcrPreprocessLoader: CoreOcrPreprocessLoader }, {
      ocrTextEvidenceProvider: evidenceProvider,
    });

    const response = await client.submit(task({ surfaceId: `surface:evidence:${likelyText}` }));

    assert.equal(response.ok, true, String(likelyText));
    assert.equal(evidenceCalls, 1, String(likelyText));
    assert.equal(ocrCalls, likelyText ? 2 : 1, String(likelyText));
    assert.equal(preprocessCalls, likelyText ? 1 : 0, String(likelyText));
    const diagnostics = await client.recentDiagnostics();
    const evidence = diagnostics.ok ? diagnostics.records.find((record) => record.type === "ocr-text-evidence") : undefined;
    assert.equal(evidence?.likelyText, likelyText);
    assert.equal(Number(evidence?.edgeDensity) >= 0, true);
    assert.equal(Number(evidence?.contrast) >= 0, true);
    assert.equal(likelyText ? Number(evidence?.candidateWindowCount) >= 2 : evidence?.candidateWindowCount === 0, true);
    const diagnosticText = JSON.stringify(evidence);
    assert.equal(diagnosticText.includes("data:image"), false);
    assert.equal(diagnosticText.includes("https://"), false);
  }
});

test("DirectClient fails submit and skips translator when rescue OCR returns a provider error", async () => {
  let ocrCalls = 0;
  let translatorCalls = 0;
  const preprocessLoader: CoreOcrPreprocessLoader = {
    withVariant: async (source, variant, consume) => consume({
      imageBytes: new Uint8Array([8]),
      fileName: `${variant.id}.png`,
      mimeType: "image/png",
      recognitionUnit: applyOcrPreprocessVariantToUnit(source.recognitionUnit, variant),
      ocrVariant: variant.id,
    }),
  };
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      if (ocrCalls === 1) {
        return new Response(JSON.stringify({
          words_result: [{ words: "H3LL?", score: 0.2, location: { left: 10, top: 20, width: 80, height: 20 } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: "quota exhausted" }), { status: 402, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const base = settings(fetchImpl);
  const client = new DirectClient({
    ...base,
    retryCount: 0,
    directOcr: { ...base.directOcr, maxOcrRescueCallsPerImage: 1 },
    __testOcrPreprocessLoader: preprocessLoader,
  } as ExtensionSettings & { __testOcrPreprocessLoader: CoreOcrPreprocessLoader });

  const response = await client.submit(task());

  assert.equal(response.ok, false);
  assert.match(response.ok ? "" : response.error, /^OCR rescue \(grayscale-contrast, unit x=0,y=0,w=100,h=100\) failed:/);
  assert.equal(translatorCalls, 0);
});

test("DirectClient safely treats evidence provider failures as false", async () => {
  let ocrCalls = 0;
  let preprocessCalls = 0;
  const preprocessLoader: CoreOcrPreprocessLoader = {
    withVariant: async () => {
      preprocessCalls += 1;
      throw new Error("must not preprocess");
    },
  };
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      return new Response(JSON.stringify({ words_result: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const base = settings(fetchImpl);
  const client = new DirectClient({
    ...base,
    __testOcrPreprocessLoader: preprocessLoader,
  } as ExtensionSettings & { __testOcrPreprocessLoader: CoreOcrPreprocessLoader }, {
    ocrTextEvidenceProvider: async () => { throw new Error("local decode failed"); },
  });

  const response = await client.submit(task());

  assert.equal(response.ok, true);
  assert.equal(response.status, "empty");
  assert.equal(ocrCalls, 1);
  assert.equal(preprocessCalls, 0);
  const diagnostics = await client.recentDiagnostics();
  const evidence = diagnostics.ok ? diagnostics.records.find((record) => record.type === "ocr-text-evidence") : undefined;
  assert.deepEqual({
    likelyText: evidence?.likelyText,
    edgeDensity: evidence?.edgeDensity,
    contrast: evidence?.contrast,
    candidateWindowCount: evidence?.candidateWindowCount,
  }, {
    likelyText: false,
    edgeDensity: 0,
    contrast: 0,
    candidateWindowCount: 0,
  });
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

test("DirectClient uses fixed 4096px tiles only when the independent per-image cap can cover the full image", async () => {
  const naturalSize = { width: 1000, height: 16000 };
  const requiredPlan = planRecognitionUnits({
    surfaceId: "required",
    naturalSize,
    maxTileHeight: DIRECT_OCR_MAX_TILE_HEIGHT,
    overlapRatio: DIRECT_OCR_TILE_OVERLAP_RATIO,
    reason: "automatic",
  });
  const required = requiredPlan.units.length;

  for (const cap of [2, 3, 4, 5, 6]) {
    let ocrCalls = 0;
    let cropperCalls = 0;
    let croppedUnits = requiredPlan.units.slice(0, 0);
    const cropper: RecognitionTileCropper = async (_imageData, units, consume) => {
      cropperCalls += 1;
      croppedUnits = units;
      for (const [index, unit] of units.entries()) {
        await consume({ unit, imageBytes: new Uint8Array([index + 1]), mimeType: "image/png" }, index, units.length);
      }
    };
    const fetchImpl = (async (url) => {
      if (String(url).includes("ocr")) {
        ocrCalls += 1;
        return new Response(JSON.stringify({
          words_result: [{ words: `CAP ${cap}`, location: { left: 10, top: 20, width: 80, height: 20 } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = new DirectClient(settingsWithTileCropper(fetchImpl, cropper, cap, 1));

    const response = await client.submit(task({ naturalSize, renderSize: naturalSize }));

    assert.equal(response.ok, true, `cap=${cap}`);
    const diagnostics = await client.recentDiagnostics();
    assert.equal(diagnostics.ok, true);
    const record = diagnostics.ok ? diagnostics.records[0] : undefined;
    if (required > cap) {
      assert.equal(ocrCalls, 1, `cap=${cap} must fall back to one whole-image OCR`);
      assert.equal(cropperCalls, 0, `cap=${cap} must not crop a partial page`);
      assert.equal(record?.tileCount, 1);
      assert.equal(record?.note, `tiling skipped: required ${required} > cap ${cap}`);
    } else {
      assert.equal(ocrCalls, required, `cap=${cap} must use every required tile`);
      assert.equal(cropperCalls, 1);
      assert.equal(croppedUnits.length, required);
      assert.equal(croppedUnits.every((unit) => unit.crop.height <= DIRECT_OCR_MAX_TILE_HEIGHT), true);
      const last = croppedUnits.at(-1)!;
      assert.equal(last.crop.y + last.crop.height, naturalSize.height);
      assert.equal(record?.tileCount, required);
      assert.equal(record?.note, undefined);
    }
  }
});

test("DirectClient records anonymous failed tile diagnostics", async () => {
  let ocrCalls = 0;
  const cropper: RecognitionTileCropper = async (_imageData, units, consume) => {
    for (const [index, unit] of units.entries()) {
      await consume({ unit, imageBytes: new Uint8Array([index + 1]), mimeType: "image/png" }, index, units.length);
    }
  };
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      ocrCalls += 1;
      if (ocrCalls >= 2) {
        return new Response(JSON.stringify({ message: "provider timeout" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ words_result: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("translator must not run after a tile OCR failure");
  }) as typeof fetch;
  const client = new DirectClient(settingsWithTileCropper(fetchImpl, cropper));
  const signedSurfaceId = "surface:https://cdn.example/page.jpg?token=secret-token&X-Amz-Signature=secret-signature";

  const response = await client.submit(task({
    surfaceId: signedSurfaceId,
    naturalSize: { width: 1000, height: 16000 },
    renderSize: { width: 1000, height: 16000 },
  }));

  assert.equal(response.ok, false);
  assert.match(response.ok ? "" : response.error, /^OCR tile 2\/5 \(x=0,y=3584,w=1000,h=4096\) failed: Network OCR failed: 400 provider timeout/);
  const diagnostics = await client.recentDiagnostics();
  assert.equal(diagnostics.ok, true);
  const failure = diagnostics.ok ? diagnostics.records.find((record) => record.type === "recognition-tile-failure") : undefined;
  assert.match(String(failure?.imageId), /^image:[a-f0-9]{12}$/);
  assert.equal(failure?.tileIndex, 2);
  assert.equal(failure?.tileCount, 5);
  assert.deepEqual(failure?.crop, { x: 0, y: 3584, width: 1000, height: 4096 });
  const diagnosticText = JSON.stringify(diagnostics);
  assert.equal(diagnosticText.includes("secret-token"), false);
  assert.equal(diagnosticText.includes("X-Amz-Signature"), false);
  assert.equal(diagnosticText.includes("data:image"), false);
});

test("DirectClient keeps at most one tile byte buffer active during OCR", async () => {
  let activeTileBytes = 0;
  let maxActiveTileBytes = 0;
  let ocrCalls = 0;
  let translatorCalls = 0;
  const releasedTiles: number[] = [];
  const cropper: RecognitionTileCropper = async (_imageData, units, consume) => {
    for (const [index, unit] of units.entries()) {
      assert.equal(activeTileBytes, 0);
      activeTileBytes += 1;
      maxActiveTileBytes = Math.max(maxActiveTileBytes, activeTileBytes);
      await consume({ unit, imageBytes: new Uint8Array([index + 1]), mimeType: "image/png" }, index, units.length);
      assert.equal(ocrCalls, index + 1);
      activeTileBytes -= 1;
      releasedTiles.push(index + 1);
    }
  };
  const fetchImpl = (async (url) => {
    if (String(url).includes("ocr")) {
      assert.equal(activeTileBytes, 1);
      assert.deepEqual(releasedTiles, Array.from({ length: ocrCalls }, (_, index) => index + 1));
      ocrCalls += 1;
      return new Response(JSON.stringify({
        words_result: [{ words: `STREAM ${ocrCalls}`, location: { left: 10, top: 20, width: 80, height: 20 } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    translatorCalls += 1;
    assert.equal(activeTileBytes, 0);
    assert.deepEqual(releasedTiles, [1, 2, 3, 4, 5]);
    return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = new DirectClient(settingsWithTileCropper(fetchImpl, cropper));

  const response = await client.submit(task({
    naturalSize: { width: 1000, height: 16000 },
    renderSize: { width: 1000, height: 16000 },
  }));

  assert.equal(response.ok, true);
  assert.equal(maxActiveTileBytes, 1);
  assert.equal(ocrCalls, 5);
  assert.equal(translatorCalls, 1);
});


test("DirectClient rejects browser-unsafe image dimensions before invoking the tile cropper", async () => {
  let cropperCalls = 0;
  let fetchCalls = 0;
  const cropper: RecognitionTileCropper = async () => {
    cropperCalls += 1;
    throw new Error("browser cropper must not run");
  };
  const fetchImpl = (async () => {
    fetchCalls += 1;
    throw new Error("network providers must not run");
  }) as typeof fetch;
  const client = new DirectClient(settingsWithTileCropper(fetchImpl, cropper));
  const signedSurfaceId = "surface:https://cdn.example/page.jpg?token=secret-token&X-Amz-Signature=secret-signature";

  const response = await client.submit(task({
    surfaceId: signedSurfaceId,
    naturalSize: { width: 1_000_000, height: 16000 },
    renderSize: { width: 1_000_000, height: 16000 },
  }));

  assert.equal(response.ok, false);
  const error = response.ok ? "" : response.error;
  assert.match(error, /naturalSize\.width.*16384/i);
  assert.equal(error.includes(signedSurfaceId), false);
  assert.equal(error.includes("secret-token"), false);
  assert.equal(error.includes("X-Amz-Signature"), false);
  assert.equal(cropperCalls, 0);
  assert.equal(fetchCalls, 0);
});

function blankEvidencePixels(): OcrTextEvidencePixelInput {
  return createEvidencePixels((data) => {
    data.fill(255);
  });
}

function glyphEvidencePixels(): OcrTextEvidencePixelInput {
  return createEvidencePixels((data, width) => {
    data.fill(255);
    for (const [startX, startY] of [[22, 34], [68, 76]] as const) {
      for (let glyph = 0; glyph < 4; glyph += 1) {
        const x = startX + glyph * 9;
        fillEvidenceRect(data, width, x, startY, 3, 22, 24);
        fillEvidenceRect(data, width, x, startY, 7, 3, 24);
        fillEvidenceRect(data, width, x, startY + 10, 6, 3, 24);
      }
    }
  });
}

function createEvidencePixels(
  draw: (data: Uint8ClampedArray, width: number, height: number) => void,
): OcrTextEvidencePixelInput {
  const width = 128;
  const height = 128;
  const data = new Uint8ClampedArray(width * height * 4);
  draw(data, width, height);
  for (let pixel = 0; pixel < width * height; pixel += 1) data[pixel * 4 + 3] = 255;
  return { width, height, data };
}

function fillEvidenceRect(
  data: Uint8ClampedArray,
  imageWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number,
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * imageWidth + column) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
}
