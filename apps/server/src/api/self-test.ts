import type { SurfaceTask } from "@umt/shared";

export interface SelfTestStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestReport {
  ok: true;
  provider: string;
  providerProfile: string;
  targetLanguage: string;
  steps: SelfTestStep[];
  sample: {
    status: string;
    regionCount: number;
    elapsedMs: number;
  };
}

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><ellipse cx="300" cy="150" rx="190" ry="90" fill="#fff" stroke="#111" stroke-width="4"/><text x="230" y="165" font-size="42">Hello</text></svg>`;

export function createSelfTestTask(targetLanguage: string): SurfaceTask {
  return {
    surfaceId: `selftest:${Date.now()}`,
    pageUrl: "selftest://local",
    domain: "selftest.local",
    imageData: `data:image/svg+xml;base64,${Buffer.from(SAMPLE_SVG).toString("base64")}`,
    viewportPriority: "p0",
    surfaceRect: { x: 0, y: 0, width: 600, height: 400 },
    naturalSize: { width: 600, height: 400 },
    renderSize: { width: 600, height: 400 },
    readingDirection: "auto",
    sourceLanguage: "auto",
    targetLanguage,
  };
}
