import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './app.vue',
    './error.vue',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2080f0',
          50:  '#e6f1ff',
          100: '#cce3ff',
          500: '#2080f0',
          600: '#1968d4',
          700: '#1453b0',
        },
      },
      fontFamily: {
        // CJK-safe fallback chain:
        //   1. Noto Sans TC  — loaded via Google Fonts (all platforms)
        //   2. PingFang TC   — macOS/iOS built-in
        //   3. Microsoft JhengHei — Windows Traditional Chinese
        //   4. 微軟正黑體 / 新細明體  — older Windows aliases
        //   5. system-ui / sans-serif — last resort
        sans: [
          'Inter',
          '"Noto Sans TC"',
          '"PingFang TC"',
          '"Microsoft JhengHei"',
          '"Microsoft JhengHei UI"',
          '\u5fae\u8edf\u6b63\u9ed1\u9ad4',  // 微軟正黑體
          'system-ui',
          'sans-serif',
        ],
        // Mono: include CJK fallbacks so Chinese text in code blocks renders
        mono: [
          '"JetBrains Mono"',
          'Consolas',
          '"Noto Sans Mono CJK TC"',
          '"Microsoft JhengHei"',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
