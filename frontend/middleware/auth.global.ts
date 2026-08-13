import { useAuthStore } from '../stores/auth'

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()
  const publicPaths = new Set(['/', '/login', '/first-run', '/accept-invite'])

  // 在 client 初始化時，若有 access token 却沒 me，試著拉一次。
  // 但用 3 秒 timeout 包起來，避免 backend 慢回應 / 不通時 hang 住整個 navigation。
  if (import.meta.client && auth.accessToken && !auth.me) {
    try {
      await Promise.race([
        auth.fetchMe(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])
    } catch {
      /* swallow — 進入下方的 authenticated 檢查 */
    }
  }

  const authenticated = auth.isAuthenticated

  if (!authenticated && !publicPaths.has(to.path)) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }

  // 已登入的用戶不需要再看登入頁
  if (authenticated && to.path === '/login') {
    return navigateTo('/home', { replace: true })
  }

  // /admin/* 需 manage_users capability，否則導回首頁（後端已 403，這裡只為 UX）
  if (authenticated && to.path.startsWith('/admin') && !auth.hasCapability('manage_users')) {
    return navigateTo('/home', { replace: true })
  }
})
