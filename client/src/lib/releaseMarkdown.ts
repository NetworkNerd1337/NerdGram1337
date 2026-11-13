const SAFE_PROTOCOL = /^https?:$/i;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Allow http(s) links only. `javascript:`, `data:`, and other schemes are dropped. */
export function safeReleaseHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || hasControlCharacter(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed, "https://github.com");
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOL.test(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}
