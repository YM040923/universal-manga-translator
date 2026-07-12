import { directHttpUrlPolicyError, type UmtActivateSiteResponse, type UmtContentCommand, type UmtDirectHttpRequest, type UmtDirectHttpResponse, type UmtPageSampleSelfTestResponse } from "../content/messages.js";
import type { ExtensionSettings } from "../settings/settings.js";
import type { PopupDeps, PopupTab } from "./types.js";

type DirectHttpFormFields = NonNullable<NonNullable<UmtDirectHttpRequest["init"]>["formFields"]>;

export async function runSelfTest(settings: ExtensionSettings, deps: PopupDeps, tab?: PopupTab | null, siteEnabled = false): Promise<string> {
  if (settings.runMode === "backend") {
    try { return await (deps.checkBackend ?? defaultCheckBackend)(settings.backendUrl) ? "后端连通正常" : "后端离线或无法访问"; }
    catch (error) { return `后端自检失败：${formatError(error)}`; }
  }
  const results: string[] = [];
  if (!settings.directOcr.apiUrl || !settings.directOcr.apiKeys.length) results.push("OCR 未配置");
  else results.push(await testDirectOcr(settings, deps, tab, siteEnabled));
  if (!settings.directTranslator.baseUrl || !settings.directTranslator.apiKey || !settings.directTranslator.model) results.push("翻译 API 未配置");
  else results.push(await testTranslator(settings, deps));
  return results.join("；");
}

async function testDirectOcr(settings: ExtensionSettings, deps: PopupDeps, tab?: PopupTab | null, siteEnabled = false): Promise<string> {
  const key = settings.directOcr.apiKeys[0] ?? "";
  const imageBase64 = OCR_SELF_TEST_PNG_BASE64;
  const formFields: DirectHttpFormFields = settings.directOcr.inputMode === "file"
    ? [{ type: "file", name: settings.directOcr.imageField || "file", fileName: "selftest.png", mimeType: "image/png", base64: imageBase64 }]
    : [
      { type: "text", name: settings.directOcr.imageField || "image_base64", value: imageBase64 },
      { type: "text", name: "image_name", value: "selftest.png" },
    ];
  appendStaticOcrFields(formFields, settings.directOcr.staticFieldsText);
  const response = await directHttp(deps, { url: settings.directOcr.apiUrl, init: { method: "POST", headers: { authorization: `Bearer ${key}` }, formFields } });
  const bodyText = response.bodyText ?? "";
  if (!response.ok) return explainHttpFailure("OCR", response.status, bodyText, response.error ?? response.statusText ?? "");
  const providerError = extractProviderError(bodyText);
  if (providerError) return explainHttpFailure("OCR", response.status, bodyText, providerError);
  const parsed = parseSelfTestOcrRegions(bodyText, settings);
  if (parsed.status === "ok") return `OCR 解析正常：识别 ${parsed.count} 行 · ${parsed.preview}`;
  if (parsed.status === "mapping-mismatch") return "OCR 接口连通正常；未解析到文字区域，请检查 regionsPaths/textPaths/boxPaths 字段映射";
  const pageSample = await testCurrentPageOcrSample(deps, tab, siteEnabled);
  if (pageSample) return pageSample;
  if (parsed.status === "empty") return siteEnabled
    ? "OCR 接口连通正常；页面样本自检未执行，请确认当前标签页已重载插件并处于漫画阅读页"
    : "OCR 接口连通正常；测试图未返回文字区域。当前网站未启用，无法执行页面样本自检";
  return "OCR 接口连通正常；未解析到文字区域，请检查 regionsPaths/textPaths/boxPaths 字段映射";
}

async function testCurrentPageOcrSample(deps: PopupDeps, tab?: PopupTab | null, siteEnabled = false): Promise<string> {
  if (!siteEnabled) return "";
  if (!tab?.id) return "OCR 接口连通正常；页面样本自检未执行：无法读取当前标签页";
  try {
    const response = await sendPageSampleSelfTestCommand(deps, tab);
    if (!response) return "OCR 接口连通正常；页面样本自检未返回，请重载当前漫画页或重新启用该网站";
    if (response.ok) return `页面样本 OCR 正常：第 ${response.surfaceIndex} 张，识别 ${response.regionCount} 个区域`;
    if (response.status === "no-reader-page" || response.status === "no-surface") return "OCR 接口连通正常；当前页没有可用于自检的漫画图片";
    return `页面样本 OCR 未通过：${response.detail}`;
  } catch {
    return "OCR 接口连通正常；页面样本自检无法连接当前页面，请重载当前漫画页后再试";
  }
}

async function sendPageSampleSelfTestCommand(deps: PopupDeps, tab: PopupTab): Promise<UmtPageSampleSelfTestResponse | undefined> {
  if (!tab.id) return undefined;
  const message: UmtContentCommand = { source: "umt-popup", command: "sampleOcrSelfTest" };
  try {
    return await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message) as UmtPageSampleSelfTestResponse | undefined;
  } catch (error) {
    if (!tab.url) throw error;
    const response = await (deps.ensureContentScript ?? deps.activateSite ?? defaultActivateSite)(tab.id, tab.url);
    if (!response.ok) throw error;
    return await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message) as UmtPageSampleSelfTestResponse | undefined;
  }
}

function explainHttpFailure(prefix: string, status: number | undefined, bodyText: string, fallback: string): string {
  const detail = extractProviderError(bodyText) || fallback;
  const statusText = status ? `${status} ` : "";
  const combined = `${statusText}${detail}`;
  if (/402|credit|quota|insufficient|余额|额度|积分不足/i.test(combined)) return `${prefix} 失败：${combined}。账户额度不足，请充值或切换 API Key。`;
  if (/401|403|unauthorized|forbidden|invalid.?key|鉴权|权限/i.test(combined)) return `${prefix} 失败：${combined}。API Key 无效或没有权限。`;
  if (/429|rate.?limit|qps|too many/i.test(combined)) return `${prefix} 失败：${combined}。请求过快或 QPS 受限，请稍后重试或降低并发。`;
  return `${prefix} 失败：${combined}`.trim();
}

function extractProviderError(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const code = parsed.code ?? parsed.error_code ?? parsed.errcode ?? parsed.error ?? "";
    const message = parsed.message ?? parsed.error_msg ?? parsed.msg ?? "";
    if (!code || String(code).toUpperCase() === "OK" || String(code).toUpperCase() === "SUCCESS" || code === 0 || code === "0") return "";
    return `${String(code)}${message ? ` ${String(message)}` : ""}`;
  } catch {
    return "";
  }
}

function appendStaticOcrFields(formFields: DirectHttpFormFields, staticFieldsText: string): void {
  let parsed: unknown;
  try {
    parsed = staticFieldsText.trim() ? JSON.parse(staticFieldsText) : {};
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  for (const [name, value] of Object.entries(parsed)) {
    if (value === undefined || value === null) continue;
    formFields.push({
      type: "text",
      name,
      value: Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value),
    });
  }
}

function parseSelfTestOcrRegions(bodyText: string, settings: ExtensionSettings): { status: "ok"; count: number; preview: string } | { status: "empty" } | { status: "mapping-mismatch" } {
  try {
    const parsed = JSON.parse(bodyText);
    const regions = firstArrayAtPaths(parsed, settings.directOcr.regionsPaths);
    if (!regions) return /words_result|text|location|box/i.test(bodyText) || containsArray(parsed) ? { status: "mapping-mismatch" } : { status: "empty" };
    if (regions.length === 0) return { status: "empty" };
    const texts = regions
      .map((region) => firstStringAtPaths(region, settings.directOcr.textPaths))
      .filter((text): text is string => Boolean(text?.trim()));
    const hasBox = regions.some((region) => settings.directOcr.boxPaths.some((path) => readPath(region, path) !== undefined));
    if (!texts.length || !hasBox) return { status: "mapping-mismatch" };
    return { status: "ok", count: texts.length, preview: texts.slice(0, 2).join(" / ").slice(0, 80) };
  } catch {
    return { status: "mapping-mismatch" };
  }
}

function containsArray(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(containsArray);
}

function firstArrayAtPaths(value: unknown, paths: string[]): unknown[] | null {
  for (const path of paths) {
    const found = readPath(value, path);
    if (Array.isArray(found)) return found;
  }
  return null;
}

function firstStringAtPaths(value: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const found = readPath(value, path);
    if (typeof found === "string") return found;
    if (typeof found === "number") return String(found);
  }
  return null;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && !Array.isArray(current)) return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

async function testTranslator(settings: ExtensionSettings, deps: PopupDeps): Promise<string> {
  const baseUrl = settings.directTranslator.baseUrl.replace(/\/$/, "");
  const models = await directHttp(deps, { url: `${baseUrl}/models`, init: { method: "GET", headers: { authorization: `Bearer ${settings.directTranslator.apiKey}` }, cache: "no-store" } });
  if (!models.ok) return explainHttpFailure("AI", models.status, models.bodyText ?? "", models.error ?? models.statusText ?? "");
  const contentType = models.headers?.["content-type"] ?? models.headers?.["Content-Type"] ?? "";
  if (!/json/i.test(contentType)) return `AI 失败：返回非 JSON。请检查 Base URL 是否包含 /v1`;
  const chat = await directHttp(deps, {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${settings.directTranslator.apiKey}`, "content-type": "application/json" },
      bodyText: JSON.stringify({
        model: settings.directTranslator.model,
        messages: [
          { role: "system", content: "You are a manga translation connectivity self-test. Return only the Chinese translation." },
          { role: "user", content: "Translate to Simplified Chinese: HELLO OCR" },
        ],
        temperature: 0,
        max_tokens: 24,
      }),
    },
  });
  if (!chat.ok) return explainHttpFailure("AI", chat.status, chat.bodyText ?? "", chat.error ?? chat.statusText ?? "");
  const chatContentType = chat.headers?.["content-type"] ?? chat.headers?.["Content-Type"] ?? "";
  if (!/json/i.test(chatContentType)) return `AI 失败：chat/completions 返回非 JSON。请检查 Base URL 和模型接口`;
  const sample = extractChatCompletionText(chat.bodyText ?? "");
  if (!sample) return "AI 失败：chat/completions 未返回可读文本，请检查模型是否兼容 OpenAI Chat Completions";
  return `AI 调用正常：${sample.slice(0, 40)}`;
}

function extractChatCompletionText(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
    const content = parsed.choices?.[0]?.message?.content ?? parsed.choices?.[0]?.text;
    return typeof content === "string" ? content.trim() : "";
  } catch {
    return "";
  }
}

const OCR_SELF_TEST_PNG_BASE64 = "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";

async function directHttp(deps: PopupDeps, request: Omit<UmtDirectHttpRequest, "source" | "command">): Promise<UmtDirectHttpResponse> {
  const policyError = directHttpUrlPolicyError(request.url);
  if (policyError) return { ok: false, status: 400, statusText: "Invalid API URL", error: policyError, bodyText: JSON.stringify({ error: policyError }), headers: {} };
  if (deps.directHttp) return deps.directHttp(request);
  return await chrome.runtime.sendMessage({ source: "umt-popup", command: "directHttp", ...request });
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function defaultCheckBackend(backendUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`${backendUrl}/health`, { cache: "no-store", signal: controller.signal });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultSendMessageToTab(tabId: number, message: UmtContentCommand): Promise<unknown> { return await chrome.tabs.sendMessage(tabId, message); }
async function defaultActivateSite(tabId: number, url: string): Promise<UmtActivateSiteResponse> { return await chrome.runtime.sendMessage({ source: "umt-popup", command: "activateSite", tabId, url }); }
