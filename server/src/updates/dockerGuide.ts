import { stableTag, parseSemver } from "./semver.js";

/** Image name #12 publishes. Tags are the same `vX.Y.Z` as the GitHub Release. */
export const GHCR_IMAGE = "ghcr.io/networknerd1337/nerdgram1337";

export const DEFAULT_CONTAINER_NAME = "nerdgram1337";
export const DEFAULT_VOLUME_NAME = "nerdgram-data";
export const DEFAULT_PUBLISH = "127.0.0.1:8787:8787";

export type DockerStep = {
  title: string;
  command: string;
};

export type DockerGuide = {
  image: string;
  tag: string;
  steps: DockerStep[];
  compose: DockerStep[];
  composeNote: string;
  persistNote: string;
};

/**
 * Copyable upgrade commands for a stable tag. The tag is validated again
 * here so a release body or a bad tag cannot change the shell text.
 */
export function dockerGuideForTag(tag: string): DockerGuide | null {
  const parsed = parseSemver(tag);
  if (!parsed) return null;
  const stable = stableTag(parsed);
  if (!stable || stable !== tag.trim()) return null;
  const image = `${GHCR_IMAGE}:${stable}`;
  const run = [
    "docker run -d",
    `--name ${DEFAULT_CONTAINER_NAME}`,
    `--restart unless-stopped`,
    `-p ${DEFAULT_PUBLISH}`,
    "-e NERDGRAM_DATA_DIR=/data",
    "-e NERDGRAM_INSTALL=docker",
    `-v ${DEFAULT_VOLUME_NAME}:/data`,
    image,
  ].join(" ");
  return {
    image: GHCR_IMAGE,
    tag: stable,
    steps: [
      { title: "Pull the new image", command: `docker pull ${image}` },
      { title: "Stop the old container", command: `docker stop ${DEFAULT_CONTAINER_NAME}` },
      { title: "Remove the old container", command: `docker rm ${DEFAULT_CONTAINER_NAME}` },
      {
        title: "Start it again with the same /data volume and loopback port",
        command: run,
      },
    ],
    compose: [
      { title: "Pull the image Compose points at", command: "docker compose pull" },
      { title: "Recreate the container", command: "docker compose up -d" },
    ],
    composeNote:
      "The Compose file should use ghcr.io/networknerd1337/nerdgram1337. If the tag is `latest` or another moving tag, pull and up are enough. If it is pinned to an older vX.Y.Z, change that pin to this release first.",
    persistNote:
      "Diagrams, favorites, trash, history, the GitHub token, and the rest of .meta live in the /data volume, along with the GitHub sync mirror .nerdgram-git. Recreating the container keeps that volume. Do not run docker volume rm, and do not change the volume you already mounted on /data. If your container or volume name is not the example above, keep the name you already use.",
  };
}
