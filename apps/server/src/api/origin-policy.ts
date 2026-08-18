/**
 * Origin / Host policy for the local backend.
 *
 * The backend binds to 127.0.0.1 but must NOT trust any webpage that can reach
 * it: a malicious site could otherwise read responses (CORS) or drive the
 * service (CSRF / DNS rebinding). We restrict:
 *  - CORS: only extension origins, local file/data pages (desktop shell), and
 *    loopback-hosted dev pages may read responses.
 *  - Host header: must be a loopback hostname, which defeats DNS rebinding.
 */

export function isAllowedRequestOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin clients, curl, tests without Origin
  if (origin === "null") return true; // data:/file: pages (desktop shell)
  try {
    const url = new URL(origin);
    if (url.protocol === "chrome-extension:") return true;
    if (url.protocol === "file:") return true;
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
