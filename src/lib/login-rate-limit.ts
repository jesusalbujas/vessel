const windowMs = 10 * 60 * 1000;
const maximumFailures = 10;
const buckets = new Map<string, number[]>();

function keyFor(username: string) {
  return username.trim().toLowerCase().slice(0, 64);
}

export function loginRetryAfterSeconds(username: string): number {
  const key = keyFor(username);
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length) buckets.set(key, recent);
  else buckets.delete(key);
  if (recent.length < maximumFailures) return 0;
  return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
}

export function recordLoginFailure(username: string) {
  const key = keyFor(username);
  if (!key) return;
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) {
    for (const [bucket, attempts] of buckets) {
      if (!attempts.length || now - attempts[attempts.length - 1] >= windowMs) buckets.delete(bucket);
      if (buckets.size <= 4000) break;
    }
  }
}

export function clearLoginFailures(username: string) {
  buckets.delete(keyFor(username));
}
