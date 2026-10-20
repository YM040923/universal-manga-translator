import { mountPopupPage } from "./main.js";

const root = document.querySelector<HTMLElement>("#app");
if (root) void mountPopupPage(root);
