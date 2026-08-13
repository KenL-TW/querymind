/**
 * Naive UI 在 SPA 模式下可直接使用 component import，
 * 這裡提供 discrete API 的全域註冊，供 composable 外部 (eg. composables) 可呼叫。
 */
import {
  create,
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  NLoadingBarProvider,
} from 'naive-ui'

export default defineNuxtPlugin((nuxtApp) => {
  const naive = create({
    components: [
      NConfigProvider,
      NMessageProvider,
      NDialogProvider,
      NNotificationProvider,
      NLoadingBarProvider,
    ],
  })
  nuxtApp.vueApp.use(naive)
})
