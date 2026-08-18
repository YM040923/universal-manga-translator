import type { ApiResponse, ConfigStatusResponse } from "@umt/shared/protocol";
import type { UmtActivateSiteResponse, UmtContentCommand, UmtDirectHttpRequest, UmtDirectHttpResponse } from "../content/messages.js";
import type { SettingsStorageArea } from "../settings/settings.js";

export interface PopupTab { id?: number; url?: string; }

export interface PopupDeps {
  storage?: SettingsStorageArea;
  queryActiveTab?: () => Promise<PopupTab | null>;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
  fetchBackendStatus?: (backendUrl: string) => Promise<{ ok: boolean; ocr?: { apiUrl?: string; apiKeyConfigured?: boolean }; openAICompatible?: { baseUrl?: string; apiKeyConfigured?: boolean } } | null>;
  configStatus?: (backendUrl: string) => Promise<ApiResponse<ConfigStatusResponse>>;
  directHttp?: (request: Omit<UmtDirectHttpRequest, "source" | "command">) => Promise<UmtDirectHttpResponse>;
  sendMessageToTab?: (tabId: number, message: UmtContentCommand) => Promise<unknown> | unknown;
  activateSite?: (tabId: number, url: string) => Promise<UmtActivateSiteResponse>;
  ensureContentScript?: (tabId: number, url: string) => Promise<UmtActivateSiteResponse>;
}

