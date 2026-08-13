<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NCard, NGrid, NGridItem, NSpace, NTag } from 'naive-ui'
import { useApi } from '../composables/useApi'
import { useAuthStore } from '../stores/auth'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '首頁' })

const auth = useAuthStore()
const api = useApi()

const health = ref<Record<string, unknown> | null>(null)
const healthErr = ref<string>('')

onMounted(async () => {
  try {
    health.value = await api.get('/v1/health')
  } catch (err: unknown) {
    healthErr.value = (err as { message?: string })?.message ?? 'Unknown error'
  }
})

const cards = computed(() => [
  { title: 'Chat',     desc: '以自然語言探索資料庫、產報表。', to: '/chat',       cap: 'query' },
  { title: 'Schema',   desc: '瀏覽所有資源、表、欄位註解。',     to: '/schema',     cap: 'view_schema' },
  { title: '樣板', desc: '一鍵使用預設分析樣板。',         to: '/templates',  cap: 'query' },
  { title: '資料字典', desc: '查閱業務名詞、指標、概念關係。', to: '/dictionary', cap: 'view_schema' },
  { title: '管理', desc: '使用者、邀請、API Key、審計。',    to: '/admin',      cap: 'manage_users' },
])

const visible = computed(() => cards.value.filter(c => auth.hasCapability(c.cap)))
const apiStatus = computed(() => String(health.value?.status ?? health.value?.ok ?? 'unknown'))
const apiVersion = computed(() => String(health.value?.version ?? '-'))
const apiEnvironment = computed(() => String(health.value?.environment ?? '-'))
const apiConnections = computed(() => {
  const value = health.value?.connections
  return Array.isArray(value) ? value.map(String) : []
})
</script>

<template>
  <div class="space-y-6">
    <NCard>
      <div class="flex items-center justify-between">
        <div>
          <div class="text-xl font-semibold">歡迎回來，{{ auth.me?.display_name || auth.me?.email }}</div>
          <div class="text-sm text-slate-500 mt-1">
            你現在的角色：
            <NTag :bordered="false" type="info" size="small" class="ml-1">{{ auth.role }}</NTag>
          </div>
        </div>
        <NSpace size="small">
          <NTag
            v-for="cap in auth.capabilities.slice(0, 8)"
            :key="cap"
            :bordered="false"
            size="small"
          >{{ cap }}</NTag>
          <NTag v-if="auth.capabilities.length > 8" size="small">+{{ auth.capabilities.length - 8 }}</NTag>
        </NSpace>
      </div>
    </NCard>

    <NGrid :cols="3" :x-gap="16" :y-gap="16" responsive="screen">
      <NGridItem v-for="c in visible" :key="c.to">
        <NuxtLink :to="c.to" class="block">
          <NCard hoverable class="h-full">
            <div class="text-base font-semibold">{{ c.title }}</div>
            <div class="text-sm text-slate-500 mt-2">{{ c.desc }}</div>
          </NCard>
        </NuxtLink>
      </NGridItem>
    </NGrid>

    <NCard title="API 狀態" size="small">
      <div v-if="health" class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div class="text-slate-500">狀態</div>
        <div>
          <NTag size="small" :type="apiStatus === 'ok' || apiStatus === 'true' ? 'success' : 'warning'" bordered>
            {{ apiStatus }}
          </NTag>
        </div>
        <div class="text-slate-500">版本</div>
        <div>{{ apiVersion }}</div>
        <div class="text-slate-500">環境</div>
        <div>{{ apiEnvironment }}</div>
        <div class="text-slate-500">資料連線</div>
        <div>
          <NSpace v-if="apiConnections.length" size="small">
            <NTag v-for="conn in apiConnections" :key="conn" size="small" bordered>{{ conn }}</NTag>
          </NSpace>
          <span v-else class="text-slate-400">未註冊</span>
        </div>
      </div>
      <div v-else-if="healthErr" class="text-sm text-red-500">{{ healthErr }}</div>
      <div v-else class="text-sm text-slate-400">查詢中…</div>
    </NCard>
  </div>
</template>
