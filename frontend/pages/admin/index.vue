<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NCard, NGrid, NGridItem, NStatistic, NTag, useMessage } from 'naive-ui'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '管理 / 概覽' })

const api = useApi()
const message = useMessage()

interface Stats {
  total_calls: number
  total_errors: number
  error_rate: number
  calls_by_event: Array<{ event_type: string; count: number }>
  calls_by_api_key_prefix: Array<{ api_key_prefix: string; count: number }>
  poc_summary?: {
    active_users: number
    questions: number
    success_rate: number
    error_rate: number
    token_cost_usd: number
    rbac_denies: number
    write_blocks: number
    export_events: number
    dlp_events: number
    dlp_redactions: number
    top_connections: Array<{ conn_name: string; calls: number; errors: number }>
    top_tools: Array<{ tool_name: string; calls: number }>
  }
}

interface SysInfo {
  version: string
  environment: string
  auth_enabled: boolean
  rbac_enabled: boolean
  first_run_pending: boolean
}

const stats = ref<Stats | null>(null)
const sys = ref<SysInfo | null>(null)
const userCount = ref(0)
const inviteCount = ref(0)

onMounted(async () => {
  try {
    const [s, info, users, invs] = await Promise.all([
      api.get<Stats>('/v1/admin/usage-stats'),
      api.get<SysInfo>('/v1/admin/system-info'),
      api.get<unknown[]>('/v1/admin/users'),
      api.get<unknown[]>('/v1/admin/invitations'),
    ])
    stats.value = s
    sys.value = info
    userCount.value = Array.isArray(users) ? users.length : 0
    inviteCount.value = Array.isArray(invs) ? invs.length : 0
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '載入失敗')
  }
})
</script>

<template>
  <div>
    <AdminTabs />

    <NGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen">
      <NGridItem>
        <NCard><NStatistic label="API 呼叫總數" :value="stats?.total_calls ?? 0" /></NCard>
      </NGridItem>
      <NGridItem>
        <NCard><NStatistic label="錯誤次數" :value="stats?.total_errors ?? 0" /></NCard>
      </NGridItem>
      <NGridItem>
        <NCard><NStatistic label="使用者數" :value="userCount" /></NCard>
      </NGridItem>
      <NGridItem>
        <NCard><NStatistic label="未使用邀請" :value="inviteCount" /></NCard>
      </NGridItem>
    </NGrid>

    <NCard title="事件類型分佈" size="small" class="mt-4">
      <div v-if="stats && stats.calls_by_event.length" class="space-y-1 text-sm">
        <div
          v-for="row in stats.calls_by_event"
          :key="row.event_type"
          class="flex justify-between border-b last:border-0 py-1"
        >
          <span>{{ row.event_type }}</span>
          <span class="text-slate-500">{{ row.count }}</span>
        </div>
      </div>
      <div v-else class="text-slate-400 text-sm">無資料</div>
    </NCard>

    <NCard title="B2B PoC 管理摘要" size="small" class="mt-4">
      <NGrid :cols="4" :x-gap="12" :y-gap="12" responsive="screen">
        <NGridItem>
          <NStatistic label="活躍使用者" :value="stats?.poc_summary?.active_users ?? 0" />
        </NGridItem>
        <NGridItem>
          <NStatistic label="問題數" :value="stats?.poc_summary?.questions ?? 0" />
        </NGridItem>
        <NGridItem>
          <NStatistic
            label="成功率"
            :value="`${Math.round((stats?.poc_summary?.success_rate ?? 0) * 100)}%`"
          />
        </NGridItem>
        <NGridItem>
          <NStatistic
            label="Token 成本估算"
            :value="`$${(stats?.poc_summary?.token_cost_usd ?? 0).toFixed(4)}`"
          />
        </NGridItem>
      </NGrid>
      <div class="mt-3 flex flex-wrap gap-2 text-xs">
        <NTag size="small" type="warning" bordered>RBAC deny: {{ stats?.poc_summary?.rbac_denies ?? 0 }}</NTag>
        <NTag size="small" type="error" bordered>Write blocked: {{ stats?.poc_summary?.write_blocks ?? 0 }}</NTag>
        <NTag size="small" type="info" bordered>Export: {{ stats?.poc_summary?.export_events ?? 0 }}</NTag>
        <NTag size="small" type="success" bordered>DLP redactions: {{ stats?.poc_summary?.dlp_redactions ?? 0 }}</NTag>
      </div>
      <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div class="text-xs font-semibold text-slate-500 mb-2">熱門 connection</div>
          <div v-if="stats?.poc_summary?.top_connections?.length" class="space-y-1 text-sm">
            <div
              v-for="row in stats.poc_summary.top_connections"
              :key="row.conn_name"
              class="flex justify-between border-b last:border-0 py-1"
            >
              <span>{{ row.conn_name }}</span>
              <span class="text-slate-500">{{ row.calls }} calls / {{ row.errors }} errors</span>
            </div>
          </div>
          <div v-else class="text-slate-400 text-sm">無資料</div>
        </div>
        <div>
          <div class="text-xs font-semibold text-slate-500 mb-2">熱門工具</div>
          <div v-if="stats?.poc_summary?.top_tools?.length" class="space-y-1 text-sm">
            <div
              v-for="row in stats.poc_summary.top_tools"
              :key="row.tool_name"
              class="flex justify-between border-b last:border-0 py-1"
            >
              <span>{{ row.tool_name }}</span>
              <span class="text-slate-500">{{ row.calls }}</span>
            </div>
          </div>
          <div v-else class="text-slate-400 text-sm">無資料</div>
        </div>
      </div>
    </NCard>
  </div>
</template>
