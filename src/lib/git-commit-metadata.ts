import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const execFileAsync = promisify(execFile);
const checkoutRoot = resolve(/* turbopackIgnore: true */ process.env.VESSEL_GIT_ROOT ?? "/app/data/git-sources");

/** Read commit subjects from Vessel's local checkout only; never contacts the remote provider. */
export async function localGitCommitTitles(sourceId: string, commits: string[]) {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(sourceId)) return {};
  const shas = [...new Set(commits.filter((sha): sha is string => typeof sha === "string" && /^[a-f0-9]{40,64}$/i.test(sha)))].slice(0, 10);
  if (!shas.length) return {};
  const repository = resolve(checkoutRoot, sourceId, "repository");
  const rel = relative(checkoutRoot, repository);
  if (!rel || rel.startsWith(`..${sep}`) || rel === "..") return {};
  try {
    await access(resolve(repository, ".git"));
    const { stdout } = await execFileAsync("git", ["log", "--no-walk", "--format=%H%x09%s", ...shas], {
      cwd: repository,
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    return Object.fromEntries(stdout.split("\n").filter(Boolean).flatMap((line) => {
      const tab = line.indexOf("\t");
      return tab > 0 ? [[line.slice(0, tab), line.slice(tab + 1).trim().slice(0, 500)]] : [];
    }));
  } catch {
    return {};
  }
}
