"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

type UserRow = {
  id: number;
  email: string;
  role: string;
  display_name: string;
  is_active: boolean;
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");

  async function refresh() {
    const data = await apiFetch<UserRow[]>("/v1/admin/users");
    setUsers(data);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    await apiFetch("/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    setEmail("");
    setRole("viewer");
    await refresh();
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-3xl">使用者管理</h2>
      <form onSubmit={createUser} className="grid gap-3 md:grid-cols-[1fr_180px_120px]">
        <input className="input" placeholder="new.user@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">viewer</option>
          <option value="analyst">analyst</option>
          <option value="editor">editor</option>
          <option value="dba">dba</option>
          <option value="owner">owner</option>
        </select>
        <button className="btn-primary" type="submit">新增</button>
      </form>
      <div className="overflow-hidden rounded-xl border border-black/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left">
            <tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-black/10">
                <td className="px-3 py-2">{u.id}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2">{u.is_active ? "active" : "inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
