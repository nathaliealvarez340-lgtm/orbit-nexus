import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { normalizeBillingUrl } from "@/lib/billing-url";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export class PortalNetworkError extends Error {
  constructor(
    public code: "INVALID_URL" | "AUTOMATION_TIMEOUT" | "DOWNLOAD_FAILED",
  ) {
    super(code);
  }
}
type Resolver = (
  host: string,
) => Promise<{ address: string; family: number }[]>;
export async function validateNavigationUrl(
  raw: string,
  allowedHosts?: string[],
  resolve: Resolver = (host) => lookup(host, { all: true, verbatim: true }),
) {
  const normalized = normalizeBillingUrl(raw);
  if (!normalized) throw new PortalNetworkError("INVALID_URL");
  const url = new URL(normalized);
  if (allowedHosts && !allowedHosts.includes(url.hostname))
    throw new PortalNetworkError("INVALID_URL");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      resolve(url.hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PortalNetworkError("AUTOMATION_TIMEOUT")),
          5000,
        );
      }),
    ]);
    if (
      !addresses.length ||
      addresses.some((item) => !isPublicAddress(item.address))
    )
      throw new PortalNetworkError("INVALID_URL");
    return { url, address: addresses[0] };
  } catch (error) {
    throw error instanceof PortalNetworkError
      ? error
      : new PortalNetworkError("INVALID_URL");
  } finally {
    clearTimeout(timer);
  }
}
/** Every connection uses the validated IP, not a second DNS resolution. No automatic redirects. */
export async function pinnedPortalRequest(
  raw: string,
  options: {
    allowedHosts: string[];
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer;
    maxBytes?: number;
  },
) {
  const { url, address } = await validateNavigationUrl(
    raw,
    options.allowedHosts,
  );
  return new Promise<{
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }>((resolve, reject) => {
    const headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).filter(
        ([key]) =>
          !/^(host|connection|authorization|proxy-authorization|transfer-encoding|content-length|accept-encoding)$/i.test(
            key,
          ),
      ),
    );
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      url,
      {
        method: options.method ?? "GET",
        headers,
        family: address.family,
        lookup: (_host, _options, callback) => {
          callback(null, address.address, address.family);
        },
        signal: AbortSignal.timeout(15000),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > (options.maxBytes ?? 12 * 1024 * 1024))
            req.destroy(new PortalNetworkError("DOWNLOAD_FAILED"));
          else chunks.push(chunk);
        });
        res.on("error", () =>
          reject(new PortalNetworkError("DOWNLOAD_FAILED")),
        );
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 502,
            headers: Object.fromEntries(
              Object.entries(res.headers)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.join("\n") : String(v),
                ]),
            ),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", (error) =>
      reject(
        error instanceof PortalNetworkError
          ? error
          : new PortalNetworkError("AUTOMATION_TIMEOUT"),
      ),
    );
    if (options.body) req.write(options.body);
    req.end();
  });
}
