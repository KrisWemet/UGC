import { lookup } from "node:dns/promises";
import net from "node:net";

// Fetches a public http(s) URL. Rejects private, loopback and link-local
// addresses (including cloud metadata endpoints) on every redirect hop, so a
// user-supplied URL can't make the server reach internal services.

const MAX_REDIRECTS = 5;

export class UnsafeUrlError extends Error {}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb")
  );
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new UnsafeUrlError(`Could not resolve ${host}.`);
      });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError(`${host} resolves to a private address.`);
  }
  return url;
}

export async function safeFetch(
  raw: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init;
  let current = await assertPublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      ...rest,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError("Too many redirects.");
}

// Downloads a public URL into memory, refusing anything over maxBytes.
export async function downloadBuffer(raw: string, maxBytes = 200 * 1024 * 1024): Promise<Buffer> {
  const res = await safeFetch(raw, { timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${raw}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`File too large: ${raw}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`File too large: ${raw}`);
  return buf;
}
