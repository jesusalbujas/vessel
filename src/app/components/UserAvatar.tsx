"use client";

import { useEffect, useState } from "react";

export function UserAvatar({ username, avatarUrl, className = "" }: { username: string; avatarUrl?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatarUrl]);
  return <span className={`${className}${avatarUrl && !failed ? " has-photo" : ""}`} aria-label={username}>
    {avatarUrl && !failed ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : username.slice(0, 1).toUpperCase()}
  </span>;
}
