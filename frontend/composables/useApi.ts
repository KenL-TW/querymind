/**
 * Typed $fetch wrapper that：
 *   1. 自動 prepend apiBase
 *   2. 自動帶 Authorization: Bearer <access_token>
 *   3. credentials: 'include' 以便 HttpOnly refresh cookie 來回
 *   4. 401 時嘗試 refresh 並 retry 一次
 */
import { useAuthStore } from '../stores/auth'

let refreshInFlight: Promise<boolean> | null = null
type ApiFetchOptions = NonNullable<Parameters<typeof $fetch>[1]>

export function useApi() {
  const cfg = useRuntimeConfig()
  const auth = useAuthStore()

  async function request<T = unknown>(
    path: string,
    opts: ApiFetchOptions = {},
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${cfg.public.apiBase}${path}`

    const headers: Record<string, string> = {
      ...(opts.headers as Record<string, string> | undefined),
    }
    if (auth.accessToken) {
      headers.Authorization = `Bearer ${auth.accessToken}`
    }

    try {
      return await $fetch<T>(url, {
        ...opts,
        headers,
        credentials: 'include',
      })
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number }; status?: number })?.response?.status
        ?? (err as { status?: number })?.status

      if (status === 401 && auth.accessToken) {
        // 只讓一個 refresh 請求同時進行
        refreshInFlight = refreshInFlight ?? auth.refresh()
        const ok = await refreshInFlight
        refreshInFlight = null
        if (ok) {
          return await $fetch<T>(url, {
            ...opts,
            headers: { ...headers, Authorization: `Bearer ${auth.accessToken}` },
            credentials: 'include',
          })
        }
        await navigateTo('/login')
      }
      throw err
    }
  }

  return {
    request,
    get:  <T = unknown>(p: string, o: ApiFetchOptions = {}) =>
      request<T>(p, { ...o, method: 'GET' }),
    post: <T = unknown>(p: string, body?: unknown, o: ApiFetchOptions = {}) =>
      request<T>(p, { ...o, method: 'POST', body: body as Record<string, unknown> }),
    put:  <T = unknown>(p: string, body?: unknown, o: ApiFetchOptions = {}) =>
      request<T>(p, { ...o, method: 'PUT', body: body as Record<string, unknown> }),
    patch: <T = unknown>(p: string, body?: unknown, o: ApiFetchOptions = {}) =>
      request<T>(p, { ...o, method: 'PATCH', body: body as Record<string, unknown> }),
    del:  <T = unknown>(p: string, o: ApiFetchOptions = {}) =>
      request<T>(p, { ...o, method: 'DELETE' }),

    /** Download a binary file with auth headers via native fetch + blob URL. */
    async downloadBlob(
      path: string,
      filename: string,
      method: 'GET' | 'POST' = 'POST',
      body?: unknown,
    ): Promise<void> {
      const url = path.startsWith('http') ? path : `${cfg.public.apiBase}${path}`
      const headers: Record<string, string> = {}
      if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`
      if (body) headers['Content-Type'] = 'application/json'

      const resp = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(errText || `HTTP ${resp.status}`)
      }

      const blob = await resp.blob()
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objUrl)
    },
  }
}
