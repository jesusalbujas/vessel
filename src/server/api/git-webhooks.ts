import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { gitProviderWebhookSecrets } from "@/lib/control-plane";
import { dispatchGitWebhook } from "@/lib/git-deployments";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hmac(secret: string, body: Buffer) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function githubSignature(secret: string, body: Buffer, header: string) {
  const received = header.replace(/^sha256=/, "");
  return /^[a-f0-9]{64}$/i.test(received) && secureEqual(hmac(secret, body), received);
}

function gitlabEvent(event: string, payload: Record<string, unknown>) {
  if (event === "Push Hook" || event === "Tag Push Hook") {
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    const commits = Array.isArray(payload.commits) ? payload.commits as Array<Record<string, unknown>> : [];
    const changedFiles = commits.flatMap((commit) => [
      ...(Array.isArray(commit.added) ? commit.added : []),
      ...(Array.isArray(commit.modified) ? commit.modified : []),
      ...(Array.isArray(commit.removed) ? commit.removed : []),
    ]).filter((file): file is string => typeof file === "string");
    return [{ event: "push", payload: { repository: payload.project, ref, after: payload.after, changedFiles } }];
  }
  if (event === "Release Hook") {
    const release = payload.release as Record<string, unknown> | undefined;
    return [{ event: "release", payload: { repository: payload.project, action: payload.action ?? "published", release: { tag_name: release?.tag_name } } }];
  }
  return null;
}

function giteaEvent(event: string, payload: Record<string, unknown>) {
  if (event === "push") {
    const commits = Array.isArray(payload.commits) ? payload.commits as Array<Record<string, unknown>> : [];
    const changedFiles = commits.flatMap((commit) => [
      ...(Array.isArray(commit.added) ? commit.added : []),
      ...(Array.isArray(commit.modified) ? commit.modified : []),
      ...(Array.isArray(commit.removed) ? commit.removed : []),
    ]).filter((file): file is string => typeof file === "string");
    return [{ event: "push", payload: { repository: payload.repository, ref: payload.ref, after: payload.after, changedFiles } }];
  }
  if (event === "create") {
    const type = payload.ref_type;
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    if (type === "tag") return [{ event: "push", payload: { repository: payload.repository, ref: `refs/tags/${ref}`, after: "" } }];
    return null;
  }
  if (event === "release") {
    const release = payload.release as Record<string, unknown> | undefined;
    return [{ event: "release", payload: { repository: payload.repository, action: payload.action, release: { tag_name: release?.tag_name } } }];
  }
  return null;
}

function bitbucketEvent(event: string, payload: Record<string, unknown>) {
  if (event !== "repo:push") return null;
  const push = payload.push as { changes?: Array<{ new?: { type?: string; name?: string; target?: { hash?: string } } | null }> } | undefined;
  const repository = payload.repository;
  return (push?.changes ?? []).flatMap((change) => {
    const ref = change.new;
    if (!ref?.name || !["branch", "tag"].includes(ref.type ?? "")) return [];
    return [{ event: "push", payload: { repository, ref: `refs/${ref.type === "tag" ? "tags" : "heads"}/${ref.name}`, after: ref.target?.hash } }];
  });
}

export async function receiveGitWebhook(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2_000_000) return reply({ error: "Webhook payload too large" }, 413);
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > 2_000_000) return reply({ error: "Webhook payload too large" }, 413);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>; }
  catch { return reply({ error: "Invalid webhook JSON" }, 400); }

  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const gitlabToken = request.headers.get("x-gitlab-token") ?? "";
  const giteaSignature = request.headers.get("x-gitea-signature") ?? "";
  const bitbucketSignature = request.headers.get("x-hub-signature") ?? "";
  const githubEvent = request.headers.get("x-github-event") ?? "";
  const gitlabName = request.headers.get("x-gitlab-event") ?? "";
  const giteaEventName = request.headers.get("x-gitea-event") ?? "";
  const bitbucketEventName = request.headers.get("x-event-key") ?? "";
  const configured = gitProviderWebhookSecrets();
  let matched: typeof configured[number] | undefined;
  let normalized: Array<{ event: string; payload: Record<string, unknown> }> | null = null;
  let deliveryId = "";

  if (signature && githubEvent) {
    matched = configured.find((provider) => provider.provider === "github" && githubSignature(provider.secret, body, signature));
    if (!matched) return reply({ error: "Invalid webhook signature" }, 401);
    if (githubEvent === "push") {
      const commits = Array.isArray(payload.commits) ? payload.commits as Array<Record<string, unknown>> : [];
      const changedFiles = commits.flatMap((commit) => [
        ...(Array.isArray(commit.added) ? commit.added : []),
        ...(Array.isArray(commit.modified) ? commit.modified : []),
        ...(Array.isArray(commit.removed) ? commit.removed : []),
      ]).filter((file): file is string => typeof file === "string");
      normalized = [{ event: githubEvent, payload: { ...payload, changedFiles } }];
    } else normalized = [{ event: githubEvent, payload }];
    deliveryId = request.headers.get("x-github-delivery") ?? randomUUID();
  } else if (gitlabToken && gitlabName) {
    matched = configured.find((provider) => provider.provider === "gitlab" && secureEqual(provider.secret, gitlabToken));
    if (!matched) return reply({ error: "Invalid webhook token" }, 401);
    normalized = gitlabEvent(gitlabName, payload);
    deliveryId = request.headers.get("x-gitlab-event-uuid") ?? randomUUID();
  } else if (giteaSignature && giteaEventName) {
    matched = configured.find((provider) => provider.provider === "gitea" && secureEqual(hmac(provider.secret, body), giteaSignature));
    if (!matched) return reply({ error: "Invalid webhook signature" }, 401);
    normalized = giteaEvent(giteaEventName, payload);
    deliveryId = request.headers.get("x-gitea-delivery") ?? randomUUID();
  } else if (bitbucketSignature && bitbucketEventName) {
    const match = bitbucketSignature.match(/^sha256=([a-f0-9]{64})$/i);
    matched = match ? configured.find((provider) => provider.provider === "bitbucket" && secureEqual(hmac(provider.secret, body), match[1])) : undefined;
    if (!matched) return reply({ error: "Invalid webhook signature" }, 401);
    normalized = bitbucketEvent(bitbucketEventName, payload);
    deliveryId = request.headers.get("x-request-uuid") ?? randomUUID();
  } else {
    return reply({ error: "Unsupported or unauthenticated Git webhook" }, 401);
  }

  if (!normalized?.length || !matched) return reply({ accepted: true, queued: 0, ignored: "unsupported_event" });
  const installationId = (payload.installation as { id?: unknown } | undefined)?.id;
  if (matched.provider === "github" && matched.installationId && String(installationId ?? "") !== matched.installationId) {
    return reply({ error: "Webhook installation does not match this GitHub App" }, 403);
  }
  try {
    let queued = 0;
    for (let index = 0; index < normalized.length; index++) {
      const result = dispatchGitWebhook(matched.id, `${deliveryId}:${index}`.slice(0, 200), normalized[index].event, normalized[index].payload);
      queued += result.queued;
    }
    return reply({ accepted: true, queued }, 202);
  } catch {
    return reply({ error: "Could not queue the deployment for this webhook" }, 503);
  }
}
