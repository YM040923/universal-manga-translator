import { mountSettingsPage } from "../popup/main.js";

const root = document.querySelector<HTMLElement>("#app");
if (root) void mountSettingsPage(root);
