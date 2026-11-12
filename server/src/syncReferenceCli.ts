import { syncReference } from "./syntaxReference.js";

async function main() {
  console.log("Syncing Mermaid syntax reference from mermaid.js.org…");
  const manifest = await syncReference();
  console.log(
    `Synced ${manifest.pages.length} pages at ${manifest.lastSyncedAt}`,
  );
  for (const page of manifest.pages) {
    console.log(` - ${page.id}: ${page.title}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
