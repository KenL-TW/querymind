"use client";

import { useEffect, useState } from "react";
import { clearToken, getToken } from "./api";

export function useAuthGuard() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const ok = !!getToken();
    setAuthed(ok);
    setReady(true);
  }, []);

  return { ready, authed };
}

export function logout() {
  clearToken();
  window.location.href = "/login";
}
