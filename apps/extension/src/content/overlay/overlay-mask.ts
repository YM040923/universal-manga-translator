import { DEFAULT_SETTINGS, type OverlayAppearance } from "../../settings/settings.js";

function looksLikeSfxSourceText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(trimmed)) return true; // hangul
  const letters = Array.from(trimmed).filter((char) => /\p{L}/u.test(char));
  if (!letters.length) return true; // punctuation / symbols only
  const latin = letters.filter((char) => /[A-Za-z]/u.test(char)).length;
  if (latin > 0) return false;
  if (/[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF]/.test(trimmed)) return false; // kana/CJK body text
  return Array.from(trimmed.replace(/\s+/g, "")).length <= 6;
}

export function maskPaddingForBox(width: number, height: number, scale = 1): number {
  return Math.max(4, Math.min(24, Math.round(Math.min(width, height) * 0.045 * scale)));
}

export function maskStyleForRegion(kind: string, width = 0, height = 0, appearance: OverlayAppearance = DEFAULT_SETTINGS.overlayAppearance, sourceText?: string): { background: string; borderRadius: string; clipPath: string; textShadow: string } {
  const { maskShape: shape, ellipseX, ellipseY } = appearance;
  const ellipseClip = `ellipse(${ellipseX}% ${ellipseY}% at 50% 50%)`;
  if (shape === "transparent") return { background: "transparent", borderRadius: "0", clipPath: "none", textShadow: "0 1px 2px rgba(255,255,255,0.95),0 -1px 2px rgba(255,255,255,0.95),1px 0 2px rgba(255,255,255,0.95),-1px 0 2px rgba(255,255,255,0.95)" };
  if (kind === "sfx") {
    // Sound effects (action lettering, hangul SFX) must not be hidden behind an
    // opaque bubble: keep the artwork visible with a readable text shadow only.
    return {
      background: "transparent",
      borderRadius: "0",
      clipPath: "none",
      textShadow: "0 1px 2px rgba(255,255,255,0.95),0 -1px 2px rgba(255,255,255,0.95),1px 0 2px rgba(255,255,255,0.95),-1px 0 2px rgba(255,255,255,0.95)",
    };
  }
  // Renderer-side safety net: even when classification misses, a dialogue box
  // whose SOURCE text is non-Latin or punctuation-only (hangul SFX, mojibake
  // of them) must stay transparent instead of painting a big white bubble.
  if (kind === "dialogue" && sourceText && looksLikeSfxSourceText(sourceText)) {
    return {
      background: "transparent",
      borderRadius: "0",
      clipPath: "none",
      textShadow: "0 1px 2px rgba(255,255,255,0.95),0 -1px 2px rgba(255,255,255,0.95),1px 0 2px rgba(255,255,255,0.95),-1px 0 2px rgba(255,255,255,0.95)",
    };
  }
  const aspect = width / Math.max(1, height);
  if (shape === "rounded") return { background: "rgb(255,255,255)", borderRadius: "18px", clipPath: "inset(0 round 18px)", textShadow: "none" };
  if (shape === "ellipse") return { background: "rgb(255,255,255)", borderRadius: "999px", clipPath: ellipseClip, textShadow: "none" };
  if (kind === "dialogue") {
    // Wide text bands keep a shallow rounded band; other bubbles use a
    // size-aware rounded rectangle, which matches manhwa/webtoon bubble
    // shapes better than a forced ellipse. Users can pick "ellipse" in
    // appearance settings for Japanese-style oval bubbles.
    if (aspect >= 2.35 && width >= 360) {
      return {
        background: "rgb(255,255,255)",
        borderRadius: "18px",
        clipPath: "inset(0 round 18px)",
        textShadow: "none",
      };
    }
    const radius = Math.min(22, Math.max(10, Math.round(Math.min(width, height) * 0.1)));
    return {
      background: "rgb(255,255,255)",
      borderRadius: `${radius}px`,
      clipPath: `inset(0 round ${radius}px)`,
      textShadow: "none",
    };
  }
  return {
    background: "rgb(255,255,255)",
    borderRadius: "14px",
    clipPath: "inset(0 round 14px)",
    textShadow: "none",
  };
}
