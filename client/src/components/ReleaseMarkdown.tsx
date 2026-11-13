import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { safeReleaseHref } from "../lib/releaseMarkdown";

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeReleaseHref(typeof href === "string" ? href : undefined);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safe = safeReleaseHref(typeof src === "string" ? src : undefined);
    if (!safe || !safe.startsWith("https:")) return null;
    return <img src={safe} alt={alt ?? ""} />;
  },
};

/**
 * Release notes are untrusted Markdown from GitHub.
 * Do not add rehype-raw or dangerouslySetInnerHTML here.
 */
export function ReleaseMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="update-notes">
      <ReactMarkdown
        components={components}
        urlTransform={(url) => safeReleaseHref(url) ?? ""}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
