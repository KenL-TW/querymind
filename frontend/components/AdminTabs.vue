<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

interface TabDef { key: string; label: string; path: string }

const tabs: TabDef[] = [
  { key: 'overview', label: '總覽', path: '/admin' },
  { key: 'users', label: '使用者', path: '/admin/users' },
  { key: 'invitations', label: '邀請', path: '/admin/invitations' },
  { key: 'connections', label: '資料連線', path: '/admin/connections' },
  { key: 'audit', label: '審計日誌', path: '/admin/audit' },
  { key: 'usage', label: '用量統計', path: '/admin/usage' },
  { key: 'system', label: '系統資訊', path: '/admin/system' },
]

function isActive(t: TabDef) {
  if (t.key === 'overview') return route.path === '/admin' || route.path === '/admin/'
  return route.path.startsWith(t.path)
}
</script>

<template>
  <div class="admin-tabs mb-4 border-b border-slate-200 flex gap-1 overflow-x-auto">
    <NuxtLink
      v-for="t in tabs"
      :key="t.key"
      :to="t.path"
      class="admin-tab px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors"
      :class="isActive(t)
        ? 'border-brand-500 text-brand-600 font-medium'
        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'"
    >
      {{ t.label }}
    </NuxtLink>
  </div>
</template>

<style scoped>
.admin-tab {
  text-decoration: none;
  cursor: pointer;
}
</style>
