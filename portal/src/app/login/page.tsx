"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchHealth, login, setToken } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const health = await fetchHealth();
      if (health.first_run_pending) {
        router.push("/setup");
        return;
      }
      const data = await login(email, password);
      setToken(data.access_token);
      router.push("/dashboard");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "登入失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6">
      <section className="card w-full overflow-hidden">
        <div className="grid md:grid-cols-2">
          <div className="bg-ink p-8 text-paper">
            <h1 className="font-display text-4xl">QueryMind</h1>
            <p className="mt-4 text-sm leading-7 text-paper/90">
              SaaS 管理入口。先登入，才能進入管理與查詢工作台。
            </p>
          </div>
          <form onSubmit={onSubmit} className="p-8">
            <h2 className="font-display text-2xl">管理員登入</h2>
            <p className="mt-2 text-sm text-black/65">使用 Email + Password</p>
            <div className="mt-6 space-y-4">
              <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {err ? <p className="text-sm text-red-700">{err}</p> : null}
              <button className="btn-primary w-full" disabled={loading} type="submit">
                {loading ? "登入中..." : "登入"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
