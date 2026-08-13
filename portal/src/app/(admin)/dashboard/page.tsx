"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

type Usage = {
  total_calls: number;
  total_errors: number;
  error_rate: number;
  calls_by_event: { event_type: string; count: number }[];
};

export default function DashboardPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [system, setSystem] = useState<{ version: string; auth_enabled: boolean; first_run_pending: boolean } | null>(null);

  useEffect(() => {
    apiFetch<Usage>("/v1/admin/usage-stats").then(setUsage).catch(() => undefined);
    apiFetch<{ version: string; auth_enabled: boolean; first_run_pending: boolean }>("/v1/admin/system-info").then(setSystem).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5">
      <h2 className="font-display text-3xl">營運儀表板</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-ink p-4 text-white"><p className="text-xs opacity-80">總請求</p><p className="mt-1 text-2xl font-bold">{usage?.total_calls ?? "-"}</p></div>
        <div className="rounded-xl bg-ember p-4 text-white"><p className="text-xs opacity-80">總錯誤</p><p className="mt-1 text-2xl font-bold">{usage?.total_errors ?? "-"}</p></div>
        <div className="rounded-xl bg-accent p-4 text-white"><p className="text-xs opacity-80">錯誤率</p><p className="mt-1 text-2xl font-bold">{usage ? `${(usage.error_rate * 100).toFixed(2)}%` : "-"}</p></div>
      </div>
      <div className="rounded-xl border border-black/10 p-4">
        <h3 className="font-display text-xl">系統狀態</h3>
        <p className="mt-2 text-sm">Version: {system?.version ?? "-"}</p>
        <p className="text-sm">Auth enabled: {String(system?.auth_enabled ?? false)}</p>
        <p className="text-sm">First run pending: {String(system?.first_run_pending ?? false)}</p>
      </div>
      <div className="rounded-xl border border-black/10 p-4">
        <h3 className="font-display text-xl">事件分佈</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {(usage?.calls_by_event || []).map((x) => (
            <li key={x.event_type} className="flex justify-between rounded bg-black/5 px-3 py-2">
              <span>{x.event_type}</span><strong>{x.count}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
