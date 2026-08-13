/**
 * Vue 3 + TypeScript baseline for this Nuxt 3 frontend.
 * Disables a handful of rules that misfire on Vue 3 (named v-model
 * is valid: `v-model:value` is required by Naive UI) and on TS-typed
 * template expressions (`(r: User) => r.id`).
 */
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2022,
    sourceType: 'module',
    extraFileExtensions: ['.vue'],
  },
  rules: {
    // Vue 3 supports `v-model:argument` syntax.
    'vue/no-v-model-argument': 'off',
    // Allow TS type annotations in template inline expressions.
    'vue/no-parsing-error': 'off',
    'vue/multi-word-component-names': 'off',
  },
}
