import { defineStore } from 'pinia'

export interface MeUser {
  user_id: number | string
  email: string
  display_name?: string
  role_name: string
  capabilities?: string[]
  status?: string
  [k: string]: unknown
}

interface LoginResponse {
  access_token: string
  access_token_expires_at: string
  refresh_token: string
  refresh_token_expires_at: string
  token_type: string
  user: MeUser
}

const ACCESS_KEY = 'qm.access_token'
const ACCESS_EXP_KEY = 'qm.access_exp'
const REFRESH_KEY = 'qm.refresh_token'  // fallback when cookie unavailable
const USER_KEY = 'qm.user'

function safeLoad<T>(key: string): T | null {
  if (import.meta.server) return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}
function safeStr(key: string): string | null {
  if (import.meta.server) return null
  return localStorage.getItem(key)
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: safeStr(ACCESS_KEY) ?? '',
    accessExp:   safeStr(ACCESS_EXP_KEY) ?? '',
    refreshToken: safeStr(REFRESH_KEY) ?? '',
    me: safeLoad<MeUser>(USER_KEY),
    loading: false,
  }),

  getters: {
    // role_name is the canonical field; fall back to the legacy "role" key that
    // older backend versions may still return, then default to 'guest'.
    isAuthenticated: (s) => !!s.accessToken && !!s.me && !!(s.me.role_name || (s.me as Record<string, unknown>).role),
    role: (s) => s.me?.role_name ?? ((s.me as Record<string, unknown> | null)?.role as string) ?? 'guest',
    capabilities: (s) => s.me?.capabilities ?? [],
  },

  actions: {
    hasCapability(cap: string): boolean {
      const caps = this.me?.capabilities ?? []
      return caps.includes(cap) || caps.includes('*')
    },

    persist() {
      if (import.meta.server) return
      localStorage.setItem(ACCESS_KEY, this.accessToken)
      localStorage.setItem(ACCESS_EXP_KEY, this.accessExp)
      // 主列以 HttpOnly cookie 為主；fallback 才寫 localStorage
      if (this.refreshToken) localStorage.setItem(REFRESH_KEY, this.refreshToken)
      if (this.me) localStorage.setItem(USER_KEY, JSON.stringify(this.me))
    },

    clear() {
      this.accessToken = ''
      this.accessExp = ''
      this.refreshToken = ''
      this.me = null
      if (import.meta.client) {
        localStorage.removeItem(ACCESS_KEY)
        localStorage.removeItem(ACCESS_EXP_KEY)
        localStorage.removeItem(REFRESH_KEY)
        localStorage.removeItem(USER_KEY)
      }
    },

    async login(email: string, password: string) {
      const cfg = useRuntimeConfig()
      this.loading = true
      try {
        const data = await $fetch<LoginResponse>(`${cfg.public.apiBase}/v1/auth/login`, {
          method: 'POST',
          body: { email, password },
          credentials: 'include',
        })
        this.applySession(data)
        return this.me
      } finally {
        this.loading = false
      }
    },

    async acceptInvite(token: string, password: string, displayName = '') {
      const cfg = useRuntimeConfig()
      this.loading = true
      try {
        const data = await $fetch<LoginResponse>(`${cfg.public.apiBase}/v1/auth/accept-invite`, {
          method: 'POST',
          body: { token, password, display_name: displayName || undefined },
          credentials: 'include',
        })
        this.applySession(data)
        return this.me
      } finally {
        this.loading = false
      }
    },

    applySession(data: LoginResponse) {
      this.accessToken = data.access_token
      this.accessExp = data.access_token_expires_at
      this.refreshToken = data.refresh_token
      const rawUser = data.user as MeUser & { role?: string }
      if (!rawUser.role_name && rawUser.role) {
        rawUser.role_name = rawUser.role
      }
      this.me = rawUser
      this.persist()
    },

    async logout() {
      const cfg = useRuntimeConfig()
      try {
        await $fetch(`${cfg.public.apiBase}/v1/auth/logout`, {
          method: 'POST',
          body: { refresh_token: this.refreshToken || undefined },
          credentials: 'include',
        })
      } catch { /* swallow */ }
      this.clear()
      await navigateTo('/login')
    },

    async refresh(): Promise<boolean> {
      const cfg = useRuntimeConfig()
      try {
        const data = await $fetch<{ access_token: string; access_token_expires_at: string }>(
          `${cfg.public.apiBase}/v1/auth/refresh`,
          {
            method: 'POST',
            body: { refresh_token: this.refreshToken || undefined },
            credentials: 'include',
          },
        )
        this.accessToken = data.access_token
        this.accessExp = data.access_token_expires_at
        this.persist()
        return true
      } catch {
        this.clear()
        return false
      }
    },

    async fetchMe(): Promise<MeUser | null> {
      const cfg = useRuntimeConfig()
      if (!this.accessToken) return null
      try {
        const raw = await $fetch<MeUser & { role?: string }>(`${cfg.public.apiBase}/v1/me`, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          credentials: 'include',
        })
        // Normalise: backend may return "role" instead of "role_name"
        if (!raw.role_name && raw.role) {
          raw.role_name = raw.role
        }
        this.me = raw
        this.persist()
        return this.me
      } catch {
        return null
      }
    },
  },
})
