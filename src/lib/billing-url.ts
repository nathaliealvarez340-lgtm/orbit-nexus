/** Validates a candidate only. This module never fetches or opens the URL. */
export function normalizeBillingUrl(value: string): string | null {
  const input = value.trim();
  if (
    !input ||
    input.length > 1000 ||
    /[\s\\<>\u0000-\u001f\u007f]/.test(input) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(input)
  )
    return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input))
    return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(input) ? input : `https://${input}`,
    );
    const host = url.hostname.toLowerCase();
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(host)
    )
      return null;
    return url.href.length <= 1000 ? url.href : null;
  } catch {
    return null;
  }
}
