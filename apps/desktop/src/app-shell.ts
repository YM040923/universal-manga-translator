const T = {
  title: "Universal Manga Translator 桌面控制台",
  subtitle: "后端在后台运行；关闭本窗口不会自动停止后端。这里专门管理后端配置，插件弹窗只管网页翻译行为。",
  service: "服务控制",
  serviceHint: "先启动后端，再打开浏览器插件使用。若端口被旧进程占用，可先清理占用。",
  checking: "检测中",
  unread: "未读取",
  refresh: "刷新状态",
  start: "启动后端",
  stop: "停止后端",
  cleanup: "清理占用",
  ocrSettings: "OCR API 设置",
  genericOcr: "通用网络 OCR",
  inputMode: "输入格式",
  keyPool: "Key 池",
  keyPlaceholder: "每行一个 API Key；保存后不回显明文。留空保存=保留后端现有 Key。",
  saveOcr: "保存 OCR 设置",
  modelSettings: "翻译模型",
  model: "模型",
  targetLanguage: "目标语言",
  zhCn: "简体中文",
  zhTw: "繁体中文",
  saveModel: "保存模型设置",
  loadModels: "读取模型列表",
  cacheDiag: "缓存与诊断",
  cacheUnread: "未读取缓存",
  cacheStats: "查看缓存",
  clearCache: "清理缓存",
  selfTest: "运行完整自检",
  recentLogs: "最近日志",
  refreshLogs: "刷新日志",
  clearLogs: "清理日志",
  none: "暂无",
  running: "运行中",
  stopped: "未运行",
  owned: "本软件启动",
  existing: "已检测到已有后端",
  waiting: "等待启动",
  done: "完成",
  configLoaded: "配置已读取",
  confirmCleanup: "确定要清理占用后端端口的已有进程吗？",
};

export function createDesktopShellHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T.title}</title>
<style>
  :root{--line:#d9e5f2;--text:#102033;--muted:#64748b;--brand:#ff6a1a;--brand2:#ff8a3d;--slate:#334155;--good:#16a34a;--bad:#dc2626;--soft:#f8fafc}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#fff7ed 0,#f8fbff 32%,#edf4fb 100%);color:var(--text);font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{min-height:100vh;padding:22px}.hero{display:flex;align-items:start;justify-content:space-between;gap:18px;margin:0 auto 18px;max-width:1180px}.hero h1{font-size:30px;line-height:1.1;margin:0 0 8px}.hero p{margin:0;color:var(--muted);font-size:15px;max-width:720px}.status-card,.card{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:24px;box-shadow:0 16px 42px rgba(15,23,42,.07)}.status-card{min-width:360px;padding:16px}.status-line{display:flex;align-items:center;gap:10px;margin-bottom:10px}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:8px 12px;font-weight:900;background:#fee2e2;color:#991b1b}.pill.ok{background:#dcfce7;color:#166534}.meta{color:#475569;font-weight:700;overflow-wrap:anywhere}.badges{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.badge{display:inline-flex;align-items:center;border-radius:999px;background:#eef2ff;color:#3730a3;padding:5px 9px;font-size:12px;font-weight:800}.badge.good{background:#dcfce7;color:#166534}.badge.warn{background:#fef3c7;color:#92400e}.grid{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1.04fr .96fr;gap:16px;align-items:start}.card{padding:18px}.card h2{font-size:18px;margin:0 0 14px}.row{display:grid;grid-template-columns:150px 1fr;gap:12px;align-items:center;margin:10px 0}.row span{color:#475569;font-weight:800}.advanced{margin-top:12px;border-top:1px dashed #cbd5e1;padding-top:10px}.advanced summary{cursor:pointer;color:#475569;font-weight:900}input,select,textarea{width:100%;border:1px solid #cbd5e1;border-radius:14px;padding:10px 12px;background:var(--soft);color:#0f172a;font:inherit}textarea{min-height:84px;resize:vertical}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}button{border:0;border-radius:14px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;padding:10px 15px;font-weight:900;cursor:pointer;box-shadow:0 8px 18px rgba(255,106,26,.22)}button.secondary{background:var(--slate);box-shadow:none}button.danger{background:var(--bad);box-shadow:none}button.ghost{background:#e2e8f0;color:#334155;box-shadow:none}button:disabled{opacity:.45;cursor:not-allowed}.log{min-height:138px;max-height:310px;overflow:auto;white-space:pre-wrap;background:#0f172a;color:#e2e8f0;border-radius:16px;padding:12px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.hint{color:var(--muted);line-height:1.55}.wide{grid-column:1/-1}.oplog{margin-top:10px;color:#475569;font-weight:800;min-height:22px}@media(max-width:920px){.shell{padding:16px}.hero{flex-direction:column}.status-card{width:100%;min-width:0}.grid{grid-template-columns:1fr}.row{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div><h1>Universal Manga Translator</h1><p>${T.subtitle}</p></div>
    <section class="status-card"><div class="status-line"><span id="status" class="pill">${T.checking}</span><strong id="owned">${T.unread}</strong></div><div id="meta" class="meta">http://127.0.0.1:47831</div><div id="badges" class="badges"></div><div id="log" class="oplog"></div></section>
  </header>
  <main class="grid">
    <section class="card"><h2>${T.service}</h2><p class="hint">${T.serviceHint}</p><div class="actions"><button id="refresh" class="ghost">${T.refresh}</button><button id="start">${T.start}</button><button id="stop" class="secondary">${T.stop}</button><button id="cleanup" class="danger">${T.cleanup}</button></div></section>
    <section class="card"><h2>${T.ocrSettings}</h2><label class="row"><span>OCR 服务</span><select id="ocrPreset"><option value="generic">${T.genericOcr}</option></select></label><label class="row"><span>OCR URL</span><input id="ocrUrl" placeholder="https://example.com/ocr"></label><label class="row"><span>${T.inputMode}</span><select id="ocrInput"><option value="image_base64">image_base64</option><option value="file">file</option></select></label><label class="row"><span>${T.keyPool}</span><textarea id="ocrKeys" placeholder="${T.keyPlaceholder}"></textarea></label><details class="advanced"><summary>高级 OCR 适配参数</summary><label class="row"><span>图片字段</span><input id="ocrImageField" placeholder="image_base64"></label><label class="row"><span>固定字段 JSON</span><textarea id="ocrStaticFields" placeholder='{"need_location":true,"enable_cls":false}'></textarea></label><label class="row"><span>结果路径</span><input id="ocrRegionsPaths" placeholder="words_result,data.words_result"></label><label class="row"><span>文本路径</span><input id="ocrTextPaths" placeholder="words,text,content"></label><label class="row"><span>坐标路径</span><input id="ocrBoxPaths" placeholder="location,box,bbox"></label><label class="row"><span>置信度路径</span><input id="ocrConfidencePaths" placeholder="score,confidence"></label></details><div class="actions"><button id="saveOcr" data-backend-required>${T.saveOcr}</button></div></section>
    <section class="card"><h2>${T.modelSettings}</h2><label class="row"><span>Base URL</span><input id="baseUrl" placeholder="https://api.example.com/v1"></label><label class="row"><span>API Key</span><input id="openAiKey" type="password" placeholder="保存后不回显明文；留空保存=保留后端现有 Key"></label><label class="row"><span>${T.model}</span><select id="model"><option value="gpt-4.1-mini">gpt-4.1-mini</option></select></label><label class="row"><span>${T.targetLanguage}</span><select id="targetLanguage"><option value="zh-CN">${T.zhCn}</option><option value="zh-TW">${T.zhTw}</option></select></label><div class="actions"><button id="saveModel" data-backend-required>${T.saveModel}</button><button id="loadModels" data-backend-required class="ghost">${T.loadModels}</button></div></section>
    <section class="card"><h2>${T.cacheDiag}</h2><p id="cacheStatus" class="hint">${T.cacheUnread}</p><div class="actions"><button id="cacheStats" data-backend-required class="ghost">${T.cacheStats}</button><button id="clearCache" data-backend-required class="secondary">${T.clearCache}</button><button id="selfTest" data-backend-required>${T.selfTest}</button></div></section>
    <section class="card wide"><h2>${T.recentLogs}</h2><div class="actions"><button id="diagnostics" data-backend-required class="ghost">${T.refreshLogs}</button><button id="clearDiagnostics" data-backend-required class="secondary">${T.clearLogs}</button></div><pre id="diagnosticsLog" class="log">${T.none}</pre></section>
  </main>
</div>
<script>
const api = window.umtDesktop;
const el = (id) => document.getElementById(id);
const TXT = ${JSON.stringify(T)};
let lastStatus;
let lastBackendDetails = {};
let busy = false;

function line(value) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
function stripIpcError(error) { return (error && error.message ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^Error invoking remote method \"[^\"]+\": Error: /, '').trim() || '操作失败，请查看后端状态和配置'; }
function statusView(status) {
  const running = status && status.running === true;
  const badges = [];
  if (running && typeof status.ocrConfigured === 'boolean') badges.push({ text: 'OCR：' + (status.ocrConfigured ? '已配置' : '未配置'), good: status.ocrConfigured });
  if (running && typeof status.translatorConfigured === 'boolean') badges.push({ text: '翻译：' + (status.translatorConfigured ? '已配置' : '未配置'), good: status.translatorConfigured });
  if (running && typeof status.keyPoolCount === 'number') badges.push({ text: 'Key：' + (status.keyPoolAvailable ?? status.keyPoolCount) + '/' + status.keyPoolCount + ' 可用', good: (status.keyPoolAvailable ?? 0) > 0 });
  return { statusText: running ? TXT.running : TXT.stopped, statusClass: 'pill ' + (running ? 'ok' : 'bad'), ownerText: running ? (status.owned ? TXT.owned : TXT.existing) : TXT.waiting, metaText: running ? [status.provider, status.targetLanguage, status.url].filter(Boolean).join(' | ') : status.url, badges, startDisabled: running, stopDisabled: !running, configDisabled: !running };
}
function setBusy(next) { busy = next; document.querySelectorAll('button').forEach((button) => { if (button.id !== 'refresh') button.disabled = next || button.dataset.disabledByState === 'true'; }); }
function applyDisabledState(view) { el('start').dataset.disabledByState = String(view.startDisabled); el('stop').dataset.disabledByState = String(view.stopDisabled); document.querySelectorAll('[data-backend-required]').forEach((node) => { node.dataset.disabledByState = String(view.configDisabled); }); if (!busy) document.querySelectorAll('button').forEach((button) => { button.disabled = button.dataset.disabledByState === 'true'; }); }
function show(status) { lastStatus = status; const view = statusView(status); el('status').textContent = view.statusText; el('status').className = view.statusClass; el('owned').textContent = view.ownerText; el('meta').textContent = view.metaText; el('badges').innerHTML = view.badges.map((badge) => '<span class="badge ' + (badge.good ? 'good' : 'warn') + '">' + badge.text + '</span>').join(''); applyDisabledState(view); }
async function refresh() { const status = await api.status(); show({ ...lastBackendDetails, ...status }); }
async function run(label, fn) { el('log').textContent = label + '...'; setBusy(true); try { const result = await fn(); if (result && result.running !== undefined) show(result); el('log').textContent = label + TXT.done; return result; } catch (error) { el('log').textContent = stripIpcError(error); await refresh().catch(() => undefined); } finally { setBusy(false); if (lastStatus) applyDisabledState(statusView(lastStatus)); } }
function ensureBackendRunning() { if (!lastStatus || !lastStatus.running) throw new Error('后端未运行，请先点击“启动后端”'); }
async function backendJson(path, init) { ensureBackendRunning(); const base = lastStatus.url || 'http://127.0.0.1:47831'; const url = (base.endsWith('/') ? base.slice(0, -1) : base) + path; const response = await fetch(url, { cache: 'no-store', headers: { 'content-type': 'application/json' }, ...init }); const body = await response.json().catch(() => ({})); if (!response.ok || body.ok === false) throw new Error(body.error || body.message || ('请求失败：HTTP ' + response.status)); return body; }
function setField(id, value) { el(id).value = value ?? ''; }
function csv(values) { return Array.isArray(values) ? values.join(',') : ''; }
function parseListField(id) { return el(id).value.split(/[\\n,;]+/).map((item) => item.trim()).filter(Boolean); }
function parseJsonField(id) { const text = el(id).value.trim(); if (!text) return undefined; try { return JSON.parse(text); } catch { throw new Error('固定字段 JSON 格式不正确'); } }
async function loadConfig() { const status = await backendJson('/v1/config/status'); setField('baseUrl', status.openAICompatible?.baseUrl); const openAiKey = el('openAiKey'); openAiKey.value = ''; setModelOptions([status.openAICompatible?.model || 'gpt-4.1-mini'], status.openAICompatible?.model || ''); el('targetLanguage').value = status.targetLanguage || 'zh-CN'; setField('ocrUrl', status.ocr?.apiUrl || status.ocr?.endpoint); el('ocrInput').value = status.ocr?.inputMode || status.ocr?.input || 'image_base64'; setField('ocrImageField', status.ocr?.imageField || (el('ocrInput').value === 'file' ? 'file' : 'image_base64')); setField('ocrStaticFields', status.ocr?.staticFields ? JSON.stringify(status.ocr.staticFields, null, 2) : ''); setField('ocrRegionsPaths', csv(status.ocr?.regionsPaths)); setField('ocrTextPaths', csv(status.ocr?.textPaths)); setField('ocrBoxPaths', csv(status.ocr?.boxPaths)); setField('ocrConfidencePaths', csv(status.ocr?.confidencePaths)); el('ocrKeys').value = ''; const pool = status.ocr?.keyPool; lastBackendDetails = { provider: status.provider, targetLanguage: status.targetLanguage, ocrConfigured: status.ocr?.apiKeyConfigured, translatorConfigured: status.openAICompatible?.apiKeyConfigured, keyPoolAvailable: pool?.available, keyPoolCount: pool?.count }; show({ ...lastStatus, ...lastBackendDetails }); el('log').textContent = TXT.configLoaded; }
function setModelOptions(models, current) { el('model').innerHTML = [...new Set(models.filter(Boolean))].map((model) => '<option value="' + model + '" ' + (model === current ? 'selected' : '') + '>' + model + '</option>').join(''); }
async function runBackendAction(label, fn) { await run(label, async () => { const result = await fn(); return result && result.running !== undefined ? result : await api.status(); }); }

el('refresh').onclick = () => run(TXT.refresh, async () => { const status = await api.status(); if (status.running) setTimeout(() => loadConfig().catch((error) => { el('log').textContent = stripIpcError(error); }), 0); return status; });
el('start').onclick = () => run(TXT.start, async () => { const status = await api.start(); setTimeout(() => loadConfig().catch((error) => { el('log').textContent = stripIpcError(error); }), 0); return status; });
el('stop').onclick = () => run(TXT.stop, api.stop);
el('cleanup').onclick = () => { if (confirm(TXT.confirmCleanup)) run(TXT.cleanup, api.cleanup); };
el('loadModels').onclick = () => runBackendAction(TXT.loadModels, async () => { const models = await backendJson('/v1/models'); if (models.ok) setModelOptions(models.models, models.currentModel); el('log').textContent = line(models); });
el('saveOcr').onclick = () => runBackendAction(TXT.saveOcr, async () => { const keys = el('ocrKeys').value; const payload = { provider: 'network-ocr-openai-compatible', ocr: { apiKeys: keys.trim() ? keys : undefined, apiUrl: el('ocrUrl').value, inputMode: el('ocrInput').value, imageField: el('ocrImageField').value || (el('ocrInput').value === 'file' ? 'file' : 'image_base64'), staticFields: parseJsonField('ocrStaticFields'), regionsPaths: parseListField('ocrRegionsPaths'), textPaths: parseListField('ocrTextPaths'), boxPaths: parseListField('ocrBoxPaths'), confidencePaths: parseListField('ocrConfidencePaths') } }; el('log').textContent = line(await backendJson('/v1/config', { method: 'POST', body: JSON.stringify(payload) })); await loadConfig(); });
el('saveModel').onclick = () => runBackendAction(TXT.saveModel, async () => { const openAiKey = el('openAiKey').value; const payload = { targetLanguage: el('targetLanguage').value, openAICompatible: { baseUrl: el('baseUrl').value, model: el('model').value, apiKey: openAiKey.trim() ? openAiKey : undefined } }; el('log').textContent = line(await backendJson('/v1/config', { method: 'POST', body: JSON.stringify(payload) })); await loadConfig(); });
el('cacheStats').onclick = () => runBackendAction(TXT.cacheStats, async () => { el('cacheStatus').textContent = line(await backendJson('/v1/cache/stats')); });
el('clearCache').onclick = () => runBackendAction(TXT.clearCache, async () => { el('cacheStatus').textContent = line(await backendJson('/v1/cache/clear', { method: 'POST', body: '{}' })); });
el('selfTest').onclick = () => runBackendAction(TXT.selfTest, async () => { el('log').textContent = line(await backendJson('/v1/self-test', { method: 'POST', body: '{}' })); });
el('diagnostics').onclick = () => runBackendAction(TXT.refreshLogs, async () => { el('diagnosticsLog').textContent = line(await backendJson('/v1/diagnostics/recent?limit=30')); });
el('clearDiagnostics').onclick = () => runBackendAction(TXT.clearLogs, async () => { el('diagnosticsLog').textContent = line(await backendJson('/v1/diagnostics/clear', { method: 'POST', body: '{}' })); });

refresh().then(() => lastStatus?.running ? loadConfig().catch((error) => { el('log').textContent = stripIpcError(error); }) : undefined);
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}





