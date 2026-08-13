"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { logout, useAuthGuard } from "../../lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/users", label: "Users" },
  { href: "/audit-log", label: "Audit Log" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, authed } = useAuthGuard();

  useEffect(() => {
    if (ready && !authed) router.replace("/login");
  }, [ready, authed, router]);

  if (!ready || !authed) return null;

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-6 py-6">
      <header className="card mb-6 flex items-center justify-between px-5 py-4">
        <h1 className="font-display text-2xl">QueryMind Admin</h1>
        <button className="btn-secondary" onClick={logout}>登出</button>
      </header>
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <aside className="card p-4">
          <nav className="space-y-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm ${pathname === item.href ? "bg-accent text-white" : "hover:bg-black/5"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <section className="card p-5">{children}</section>
      </div>
    </div>
  );
}
