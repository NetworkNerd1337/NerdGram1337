const TOKEN_SHAPES = [
  /ghp_[A-Za-z0-9]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  /gho_[A-Za-z0-9]+/g,
  /ghu_[A-Za-z0-9]+/g,
  /ghs_[A-Za-z0-9]+/g,
  /ghr_[A-Za-z0-9]+/g,
];

const extraSecrets = new Set<string>();

/** Remember a value that must never appear in a response, log line, or error. */
export function rememberSecret(value: string | null | undefined): void {
  if (!value) return;
  const trimmed = value.trim();
  if (trimmed.length < 8) return;
  extraSecrets.add(trimmed);
}

export function redactText(input: string): string {
  let out = input;
  const envValues = [process.env.NERDGRAM_GITHUB_TOKEN, process.env.NERDGRAM_GITHUB_CLIENT_SECRET];
  for (const secret of extraSecrets) out = out.split(secret).join("[redacted]");
  for (const secret of envValues) {
    if (secret && secret.trim().length >= 8) out = out.split(secret.trim()).join("[redacted]");
  }
  for (const pattern of TOKEN_SHAPES) out = out.replace(pattern, "[redacted]");
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  out = out.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]");
  out = out.replace(/access_token["']?\s*[:=]\s*["']?[^"'\s&]+/gi, "access_token=[redacted]");
  out = out.replace(/device_code["']?\s*[:=]\s*["']?[^"'\s&]+/gi, "device_code=[redacted]");
  out = out.replace(/client_secret["']?\s*[:=]\s*["']?[^"'\s&]+/gi, "client_secret=[redacted]");
  return out;
}

export function clearRememberedSecrets(): void {
  extraSecrets.clear();
}

export function scrubError(err: unknown): Error {
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;
  const name = err instanceof Error ? err.name : "Error";
  const message = redactText(err instanceof Error ? err.message : "Git request failed");
  const next = new Error(message || "Git request failed");
  next.name = name;
  if (code && code !== message) {
    Object.assign(next, { code });
  }
  return next;
}
