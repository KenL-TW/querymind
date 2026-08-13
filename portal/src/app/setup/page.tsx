"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "../../lib/api";

export default function SetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("owner@local");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("Owner");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ access_token: string }>("/v1/auth/first-run/setup", {
        method: "POST",
        body: JSON.stringify({ new_email: email, new_password: password, display_name: displayName }),
      });
      setToken(data.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6">
      <section className="card w-full p-8">
        <h1 className="font-display text-3xl">首次啟用精靈</h1>
        <p className="mt-2 text-black/70">完成管理員帳號設定後，系統才會開放一般使用者介面。</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="管理員 Email" />
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="顯示名稱" />
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密碼 (至少 8 碼)" />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? "設定中..." : "完成啟用"}</button>
        </form>
      </section>
    </main>
  );
}
