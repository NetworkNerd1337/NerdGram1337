import { describe, expect, it } from "vitest";
import {
  chooseThumbnailSource,
  clearThumbnailMemory,
  lookupThumbnail,
  rememberThumbnail,
  scheduleThumbnail,
  THUMBNAIL_CONCURRENCY,
} from "../src/lib/thumbnailCache";

describe("thumbnail memory", () => {
  it("reuses a thumbnail when the mtime or cache key still matches", () => {
    clearThumbnailMemory();
    rememberThumbnail({
      path: "Welcome.mmd",
      cacheKey: "abc",
      mtimeMs: 10,
      svg: "<svg id=\"one\"></svg>",
      status: "ready",
    });
    expect(lookupThumbnail("Welcome.mmd", 10, null)).toBe("<svg id=\"one\"></svg>");
    expect(lookupThumbnail("Welcome.mmd", 99, "abc")).toBe("<svg id=\"one\"></svg>");
    expect(lookupThumbnail("Welcome.mmd", 11, "def")).toBeNull();
    expect(chooseThumbnailSource({ memorySvg: "<svg></svg>", serverSvg: null })).toBe("memory");
    expect(chooseThumbnailSource({ memorySvg: null, serverSvg: "<svg></svg>" })).toBe("server");
    expect(chooseThumbnailSource({ memorySvg: null, serverSvg: null })).toBe("render");
  });

  it("runs only a few thumbnail jobs at once and skips aborted ones", async () => {
    let active = 0;
    let max = 0;
    const jobs = Array.from({ length: THUMBNAIL_CONCURRENCY + 3 }, () =>
      scheduleThumbnail(async () => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
      }),
    );
    await Promise.all(jobs);
    expect(max).toBe(THUMBNAIL_CONCURRENCY);

    const held: Array<() => void> = [];
    const blockers = Array.from({ length: THUMBNAIL_CONCURRENCY }, () =>
      scheduleThumbnail(
        () =>
          new Promise<void>((resolve) => {
            held.push(resolve);
          }),
      ),
    );
    const controller = new AbortController();
    let ran = false;
    const queued = scheduleThumbnail(async () => {
      ran = true;
    }, controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(ran).toBe(false);
    for (const release of held) release();
    await Promise.all(blockers);
  });
});
