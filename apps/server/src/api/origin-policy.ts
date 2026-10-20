/**
 * Origin / Host policy for the local backend.
 *
 * The backend binds to 127.0.0.1 but must NOT trust any webpage that can reach
 * it: a malicious site could otherwise read responses (CORS) or drive the
 * service (CSRF / DNS rebinding) to point the OCR and translator endpoints at
 * an attacker host and exfiltrate the API keys stored in .env. We restrict:
 *  - CORS: only extension origins and loopback-hosted dev pages may read
 *    responses.
 *  - Request Origin: any other browser context is rejected outright, so a page
 *    cannot drive the service even with a CORS-free "simple" request.
 *  - Host header: must be a loopback hostname, which defeats DNS rebinding.
 *
 * `null` and `file:` origins are deliberately not trusted: every sandboxed
 * iframe and `data:` document produced by a webpage presents them. The desktop
 * shell therefore talks to the backend through its Electron main process, which
 * sends no Origin at all.
 */

export function isAllowedRequestOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin clients, curl, tests without Origin
  try {
    const url = new URL(origin);
    if (url.protocol === "chrome-extension:") return true;
    if (url.protocol === "http:" || url.protocol === "https:") {
      return isLoopbackHostname(url.hostname);
    }
    return false;
  } catch {
    return false;
  }
}

export function isAllowedServerHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
