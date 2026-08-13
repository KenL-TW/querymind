<script setup lang="ts">
import {
  NCard, NDataTable, NEmpty, NSelect, NSpin, NStatistic, NTag,
  type DataTableColumns,
} from 'naive-ui'
import { computed, h, onMounted, ref, watch } from 'vue'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '我的用量' })

interface TokenDay { date: string; prompt_tokens: number; completion_tokens: number; total_tokens: number }
interface ModelRow { model_name: string; calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number }
interface MyUsage {
  user_id: number
  window_days: number
  total_calls: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  daily_series: TokenDay[]
  by_model: ModelRow[]
}

const api = useApi()
const data = ref<MyUsage | null>(null)
const loading = ref(false)
const days = ref(30)
const dayOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
  { label: '近 365 天', value: 365 },
]

async function load() {
  loading.value = true
  try {
    data.value = await api.get<MyUsage>(`/v1/me/usage?days=${days.value}`)
  } finally { loading.value = false }
}

const maxDay = computed(() => Math.max(1, ...(data.value?.daily_series ?? []).map(d => d.total_tokens)))
const totalCost = computed(() => (data.value?.by_model ?? []).reduce((s, r) => s + (r.cost_usd || 0), 0))

const modelCols: DataTableColumns<ModelRow> = [
  { title: '模型', key: 'model_name',
    render: (r) => h(NTag, { size: 'small', type: 'warning', bordered: false }, () => r.model_name) },
  { title: '呼叫', key: 'calls', width: 80 },
  { title: 'Prompt', key: 'prompt_tokens', width: 100,
    render: (r) => h('span', { class: 'tabular-nums' }, r.prompt_tokens.toLocaleString()) },
  { title: 'Completion', key: 'completion_tokens', width: 110,
    render: (r) => h('span', { class: 'tabular-nums' }, r.completion_tokens.toLocaleString()) },
  { title: 'Total', key: 'total_tokens', width: 100,
    render: (r) => h('span', { class: 'tabular-nums font-semibold' }, r.total_tokens.toLocaleString()) },
  { title: '估算成本 (USD)', key: 'cost_usd', width: 130,
    render: (r) => h('span', { class: 'tabular-nums text-emerald-600' }, '$' + r.cost_usd.toFixed(4)) },
]

onMounted(load)
watch(days, load)
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-4 p-4">
    <div class="flex items-center gap-3 mb-2">
      <div class="font-semibold text-base">我的用量統計</div>
      <NSelect v-model:value="days" :options="dayOptions" size="small" class="!w-32" />
    </div>

    <NSpin :show="loading">
      <NCard v-if="!loading && !data" size="small">
        <NEmpty description="尚無資料" />
      </NCard>

      <div v-if="data" class="space-y-4">
        <!-- KPIs -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NCard size="small">
            <NStatistic label="呼叫次數" :value="data.total_calls" />
          </NCard>
          <NCard size="small">
            <NStatistic label="Total Tokens" :value="data.total_tokens.toLocaleString()" />
          </NCard>
          <NCard size="small">
            <NStatistic label="Prompt Tokens" :value="data.prompt_tokens.toLocaleString()" />
          </NCard>
          <NCard size="small">
            <NStatistic label="Completion Tokens" :value="data.completion_tokens.toLocaleString()" />
          </NCard>
        </div>

        <NCard size="small">
          <div class="text-xs text-slate-500 mb-1">估算費用（USD）</div>
          <div class="text-2xl font-bold text-emerald-600">${{ totalCost.toFixed(4) }}</div>
          <div class="text-xs text-slate-400 mt-1">基於各模型公開定價計算；僅供參考</div>
        </NCard>

        <!-- Daily bar -->
        <NCard title="每日 Token 趨勢" size="small">
          <div v-if="!data.daily_series.length" class="text-sm text-slate-400 py-4 text-center">此區間無資料</div>
          <div v-else class="space-y-1">
            <div v-for="d in data.daily_series" :key="d.date"
                 class="flex items-center gap-3 text-xs">
              <div class="w-24 font-mono text-slate-500">{{ d.date }}</div>
              <div class="flex-1 bg-slate-100 rounded h-5 overflow-hidden relative">
                <div class="absolute inset-y-0 left-0 bg-violet-400"
                     :style="{ width: `${(d.total_tokens / maxDay) * 100}%` }" />
              </div>
              <div class="w-28 text-right tabular-nums font-semibold">{{ d.total_tokens.toLocaleString() }}</div>
              <div class="w-24 text-right text-slate-400 tabular-nums">in {{ d.prompt_tokens.toLocaleString() }}</div>
              <div class="w-24 text-right text-slate-400 tabular-nums">out {{ d.completion_tokens.toLocaleString() }}</div>
            </div>
          </div>
        </NCard>

        <!-- By model -->
        <NCard v-if="data.by_model.length" title="模型明細" size="small">
          <NDataTable :columns="modelCols" :data="data.by_model"
                      :row-key="(r: ModelRow) => r.model_name" :bordered="false" size="small" />
        </NCard>
      </div>
    </NSpin>
  </div>
</template>
