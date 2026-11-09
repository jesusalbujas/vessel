import { NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/control-plane";
import { getDockerEngineInfo } from "@/lib/docker/engine";

type DockerUpdateResult = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  publishedAt: string | null;
  checkedAt: string;
};

let cachedRelease: { version: string; url: string; publishedAt: string | null; fetchedAt: number } | null = null;
const RELEASE_CACHE_MS = 10 * 60 * 1000;
const MIN_FORCED_REFRESH_MS = 30 * 1000;

function privateJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
}

function versionParts(value: string) {
  const match = value.trim().match(/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:$|[^\d])/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(current: string, latest: string) {
  const left = versionParts(current);
  const right = versionParts(latest);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

async function latestStableRelease(force: boolean) {
  const now = Date.now();
  if (cachedRelease && now - cachedRelease.fetchedAt < RELEASE_CACHE_MS && (!force || now - cachedRelease.fetchedAt < MIN_FORCED_REFRESH_MS)) return cachedRelease;
  const response = await fetch("https://api.github.com/repos/moby/moby/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Vessel-Docker-Update-Check" },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`Docker release source returned ${response.status}`);
  const release = await response.json() as { tag_name?: unknown; html_url?: unknown; published_at?: unknown; draft?: unknown; prerelease?: unknown };
  if (release.draft || release.prerelease || typeof release.tag_name !== "string") throw new Error("No stable Docker Engine release was found");
  const version = release.tag_name.replace(/^docker-v/i, "").replace(/^v/i, "");
  if (!versionParts(version)) throw new Error("Docker release version could not be parsed");
  const result = {
    version,
    url: typeof release.html_url === "string" ? release.html_url : "https://docs.docker.com/engine/release-notes/",
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    fetchedAt: Date.now(),
  };
  cachedRelease = result;
  return result;
}

export async function getDockerUpdate(request: Request) {
  if (!authenticatedUser(request)) return privateJson({ error: "Authentication required" }, 401);
  try {
    const currentVersion = (await getDockerEngineInfo()).ServerVersion?.replace(/^v/i, "");
    if (!currentVersion || !versionParts(currentVersion)) return privateJson({ error: "Docker Engine version is unavailable" }, 503);
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    const release = await latestStableRelease(force);
    const comparison = compareVersions(currentVersion, release.version);
    if (comparison === null) return privateJson({ error: "Could not compare Docker Engine versions" }, 502);
    const data: DockerUpdateResult = {
      currentVersion,
      latestVersion: release.version,
      updateAvailable: comparison < 0,
      releaseUrl: release.url,
      publishedAt: release.publishedAt,
      checkedAt: new Date().toISOString(),
    };
    return privateJson({ data });
  } catch (error) {
    return privateJson({ error: error instanceof Error ? error.message : "Could not check Docker Engine updates" }, 502);
  }
}
