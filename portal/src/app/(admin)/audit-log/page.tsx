"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

type AuditItem = {
  id: number;
  event_type: string;
  status: string;
  tool_name: string | null;
  api_key_prefix: string | null;
  created_at: string | null;
};

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditItem[]>([]);

  useEffect(() => {
    apiFetch<{ items: AuditItem[] }>("/v1/admin/audit-logs?page=1&size=50")
      .then((d) => setItems(d.items || []))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5">
      <h2 className="font-display text-3xl">Audit Log</h2>
      <div className="overflow-hidden rounded-xl border border-black/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Tool</th>
              <th className="px-3 py-2">Prefix</th>
              <th className="px-3 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-black/10">
                <td className="px-3 py-2">{r.id}</td>
                <td className="px-3 py-2">{r.event_type}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2">{r.tool_name || "-"}</td>
                <td className="px-3 py-2">{r.api_key_prefix || "-"}</td>
                <td className="px-3 py-2">{r.created_at || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
