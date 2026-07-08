export function normalizeOverlayText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

export function createStableTextLayout(text: string, width: number, height: number, preferred: number, kind: string): { text: string; fontSize: number } {
  const normalized = normalizeOverlayText(text);
  const fontSize = fittedFontSizeForBox(normalized, width, height, preferred, kind);
  if (!looksLikeCjkText(normalized) || normalized.includes("\n")) return { text: normalized, fontSize };
  const aspect = width / Math.max(1, height);
  const shapedWidth = kind === "dialogue"
    ? width * (aspect >= 2.35 ? 0.94 : aspect >= 1.7 ? 0.86 : 0.78)
    : width * 0.9;
  const maxCharsPerLine = Math.max(3, Math.floor(shapedWidth / Math.max(1, fontSize)));
  const desiredLines = desiredLineCount(normalized, maxCharsPerLine, width, height, kind);
  return { text: balanceCjkLines(normalized, desiredLines, maxCharsPerLine), fontSize };
}

function looksLikeCjkText(text: string): boolean {
  const chars = Array.from(text).filter((char) => !/\s/u.test(char));
  if (!chars.length) return false;
  const cjk = chars.filter((char) => /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(char));
  return cjk.length / chars.length >= 0.45;
}

function desiredLineCount(text: string, maxCharsPerLine: number, width: number, height: number, kind: string): number {
  const chars = Array.from(text.replace(/\s+/g, ""));
  const aspect = width / Math.max(1, height);
  if (kind === "dialogue" && aspect >= 2.35 && chars.length >= 18) return 2;
  const base = Math.max(1, Math.ceil(chars.length / Math.max(1, maxCharsPerLine)));
  const wideDialogueBoost = kind === "dialogue" && aspect >= 1.8 && aspect < 2.35 && chars.length >= 16 ? 1 : 0;
  const roomyBubbleBoost = kind === "dialogue" && aspect < 1.8 && width >= 360 && height >= 150 && chars.length >= 16 ? 1 : 0;
  const maxByHeight = Math.max(1, Math.floor(height / 34));
  return Math.max(1, Math.min(Math.max(base, base + wideDialogueBoost, base + roomyBubbleBoost), maxByHeight, 5));
}

function balanceCjkLines(text: string, desiredLines: number, maxCharsPerLine: number): string {
  const chars = Array.from(text.replace(/\s+/g, ""));
  if (desiredLines <= 1) return text;
  const lines: string[] = [];
  let remaining = chars;
  for (let i = desiredLines; i > 0; i -= 1) {
    if (i === 1) {
      lines.push(remaining.join(""));
      break;
    }
    const ideal = Math.ceil(remaining.length / i);
    let take = Math.min(maxCharsPerLine, Math.max(2, ideal));
    take = adjustBreakForPunctuation(remaining, take);
    lines.push(remaining.slice(0, take).join(""));
    remaining = remaining.slice(take);
  }
  return rebalanceShortTail(lines).join("\n");
}

function adjustBreakForPunctuation(chars: string[], take: number): number {
  const opening = "“‘「『《（([{";
  const closing = "，。、！？：；,.!?)]}”’」』》）";
  const badLineEnd = "，、：；,";
  let next = chars[take] ?? "";
  let previous = chars[take - 1] ?? "";
  while (take > 2 && (closing.includes(next) || badLineEnd.includes(previous))) {
    take -= 1;
    next = chars[take] ?? "";
    previous = chars[take - 1] ?? "";
  }
  while (take < chars.length - 2 && opening.includes(next)) {
    take += 1;
    next = chars[take] ?? "";
  }
  return take;
}

function rebalanceShortTail(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const result = [...lines];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const current = Array.from(result[i] ?? "");
    const previous = Array.from(result[i - 1] ?? "");
    if (current.length >= 2 || previous.length <= 3) continue;
    result[i] = `${previous.pop() ?? ""}${result[i]}`;
    result[i - 1] = previous.join("");
  }
  return result.filter(Boolean);
}


function fittedFontSizeForBox(text: string, width: number, height: number, preferred: number, kind = "dialogue"): number {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const chars = Array.from(normalized || " ");
  const explicitLines = Math.max(1, normalized.split("\n").length);
  const preferredCap = preferred >= 34 ? preferred : preferred + 12;
  const shortTextBoost = chars.length <= 18 && width >= 220 && height >= 110 ? 42 : 34;
  const lengthCap = chars.length >= 60 ? 28 : chars.length >= 36 ? 32 : shortTextBoost;
  const shallowCap = height < 115 ? 29 : height < 150 && chars.length >= 15 ? 30 : height < 180 && chars.length >= 24 ? 32 : 46;
  const ellipseCap = kind === "dialogue" ? Math.max(28, Math.min(44, Math.round(Math.min(width, height) * 0.24))) : 46;
  const contentCap = chars.length <= 18 && width >= 220 && height >= 110 ? Math.max(preferredCap, shortTextBoost) : Math.min(preferredCap, lengthCap);
  const upper = Math.max(12, Math.min(46, contentCap, shallowCap, ellipseCap));
  for (let size = upper; size >= 12; size -= 1) {
    const metrics = estimateWrappedTextMetrics(normalized, size, kind === "dialogue" ? width * 0.78 : width, explicitLines);
    if (metrics.height <= height * 0.92 && metrics.longestLineWidth <= width * 1.03) return size;
  }
  return 12;
}

function estimateWrappedTextMetrics(text: string, fontSize: number, width: number, explicitLines: number): { height: number; longestLineWidth: number } {
  const lineHeight = fontSize * 1.18;
  let lineCount = 0;
  let longestLineWidth = 0;
  for (const paragraph of (text || " ").split("\n")) {
    const paragraphWidth = estimateTextWidth(paragraph, fontSize);
    const lines = Math.max(1, Math.ceil(paragraphWidth / Math.max(1, width)));
    lineCount += lines;
    longestLineWidth = Math.max(longestLineWidth, Math.min(paragraphWidth, width));
  }
  return { height: Math.max(lineCount, explicitLines) * lineHeight, longestLineWidth };
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + fontSize * 0.32;
    if (/[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(char)) return sum + fontSize;
    if (/[A-Z0-9]/.test(char)) return sum + fontSize * 0.68;
    return sum + fontSize * 0.56;
  }, 0);
}
