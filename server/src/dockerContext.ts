/**
 * Whether a Docker build context path is excluded by a `.dockerignore` file.
 * The last matching pattern wins, including `!` exceptions. A directory
 * pattern also excludes the files under it.
 */
export function isDockerIgnored(dockerignore: string, relativePath: string): boolean {
  const file = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  let ignored = false;
  for (const raw of dockerignore.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1).trim();
    }
    if (!line) continue;
    if (line.startsWith("/")) line = line.slice(1);
    if (patternMatches(line, file)) ignored = !negate;
  }
  return ignored;
}

function patternMatches(pattern: string, file: string): boolean {
  const directory = pattern.endsWith("/");
  const body = directory ? pattern.slice(0, -1) : pattern;
  if (!body) return false;
  if (globToRegExp(body).test(file)) return true;
  if (file.startsWith(`${body}/`)) return true;
  if (!body.includes("/")) {
    return file.split("/").some((part) => globToRegExp(body).test(part));
  }
  return false;
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
        continue;
      }
      out += ".*";
      i += 1;
      continue;
    }
    const ch = pattern[i] ?? "";
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}
