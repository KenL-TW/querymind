// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  // SPA mode — 快速上線、避開 naive-ui SSR 陰影。未來有需要再轉 SSR。
  ssr: false,

  experimental: {
    appManifest: false,
  },

  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
  ],

  css: ['~/assets/css/main.css', '~/assets/css/markdown.css'],

  // 同時引入 naive-ui 供 SSR-safe 使用（依賴高頯位記錄 css-in-js style tags）。
  build: {
    transpile: ['naive-ui', 'vueuc', '@css-render/vue3-ssr', '@juggle/resize-observer'],
  },

  vite: {
    server: {
      hmr: {
        protocol: 'ws',
        host: 'localhost',
      },
    },
    optimizeDeps: {
      include: [
        'naive-ui',
        'vueuc',
        'date-fns-tz/formatInTimeZone',
        'echarts/core',
        'echarts/renderers',
        'echarts/charts',
        'echarts/components',
        'vue-echarts',
      ],
    },
  },

  runtimeConfig: {
    public: {
      // 可透過 NUXT_PUBLIC_API_BASE 環境變數覆寫。
      // 預設對應後端 API_PORT（settings.py 預設 8101，若 .env 有設定則以 .env 為準）。
      apiBase:
        process.env.NUXT_PUBLIC_API_BASE !== undefined
          ? process.env.NUXT_PUBLIC_API_BASE
          : '',
    },
  },

  nitro: {
    devProxy: {
      '/v1': {
        target: process.env.NUXT_DEV_API_PROXY_TARGET || 'http://localhost:8101/v1',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.NUXT_DEV_HEALTH_PROXY_TARGET || 'http://localhost:8101/health',
        changeOrigin: true,
      },
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-Hant' },
      title: 'QueryMind',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        // Noto Sans TC — ensures CJK rendering on all platforms
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&family=Noto+Sans+Mono+CJK+TC&display=swap',
        },
      ],
    },
  },

  typescript: {
    strict: true,
    shim: false,
  },
})
