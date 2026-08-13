<script setup lang="ts">
/**
 * Render assistant markdown content, replacing ```json fenced blocks that
 * look like ECharts options with actual interactive charts.
 *
 * Detection heuristic: parsed JSON is an object containing at least one of
 * `series`, `xAxis`, `yAxis`, `radar`, or `dataset`. Non-chart JSON blocks
 * fall through to normal syntax-highlighted markdown rendering.
 *
 * ECharts is registered globally via plugins/echarts.client.ts — no
 * defineAsyncComponent or ClientOnly needed here.
 */
import { computed, ref } from 'vue'
// useMarkdown is auto-imported by Nuxt from ~/composables
declare function useMarkdown(): { render: (s: string) => string }

const props = defineProps<{ content: string }>()

const md = useMarkdown()

interface Segment {
  type: 'md' | 'chart'
  text?: string
  option?: Record<string, unknown>
}

const CHART_KEYS = ['series', 'xAxis', 'yAxis', 'radar', 'dataset']

function looksLikeChart(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  return CHART_KEYS.some(k => k in (obj as Record<string, unknown>))
}

const segments = computed<Segment[]>(() => {
  const src = props.content || ''
  const out: Segment[] = []
  const re = /```(?:json|JSON)?\s*\n([\s\S]*?)\n```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const body = m[1].trim()
    if (!body.startsWith('{')) continue
    let parsed: unknown
    try { parsed = JSON.parse(body) } catch { continue }
    if (!looksLikeChart(parsed)) continue
    if (m.index > last) out.push({ type: 'md', text: src.slice(last, m.index) })
    out.push({ type: 'chart', option: parsed as Record<string, unknown> })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ type: 'md', text: src.slice(last) })
  if (!out.length) out.push({ type: 'md', text: src })
  return out
})

function renderMd(text: string): string {
  return md.render(text)
}

function chartOption(opt: Record<string, unknown>): Record<string, unknown> {
  const hasAxis = 'xAxis' in opt || 'yAxis' in opt
  const seriesArr = Array.isArray(opt.series) ? (opt.series as Array<{ type?: string }>) : []
  const isPie = seriesArr.some(s => s?.type === 'pie')
  const defaults: Record<string, unknown> = {
    tooltip: isPie ? { trigger: 'item' } : { trigger: hasAxis ? 'axis' : 'item' },
  }
  if (hasAxis) {
    defaults.grid = { left: 48, right: 24, top: 48, bottom: 56, containLabel: true }
  }
  return { ...defaults, ...opt }
}

const expandedOption = ref<Record<string, unknown> | null>(null)
</script>

<template>
  <div class="qm-mwc">
    <div v-for="(seg, idx) in segments" :key="idx">
      <div v-if="seg.type === 'md'" class="markdown-body" v-html="renderMd(seg.text || '')" />
      <div
        v-else
        class="qm-chart-wrap my-3 rounded-lg border border-slate-200 bg-white overflow-hidden"
      >
        <!-- Expand button row -->
        <div class="flex items-center justify-end px-2 pt-1.5">
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 px-2 py-0.5 rounded hover:bg-slate-100 transition"
            @click="expandedOption = seg.option || {}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            展開
          </button>
        </div>
        <!--
          Key fix: set explicit pixel height DIRECTLY on VChart, not on a parent wrapper.
          VChart (vue-echarts) reads its own element's offsetWidth/offsetHeight at init.
          Relying on height:100% would require a perfectly-sized ancestor chain —
          any wrapper without explicit height breaks it.
          Also: no ClientOnly or defineAsyncComponent — ECharts is pre-registered
          via plugins/echarts.client.ts, so VChart mounts synchronously with full
          dimensions available.
        -->
        <VChart
          :option="chartOption(seg.option || {})"
          autoresize
          class="qm-inline-chart"
        />
      </div>
    </div>

    <!-- Fullscreen chart modal via Teleport -->
    <Teleport to="body">
      <div
        v-if="expandedOption"
        class="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-6"
        @click.self="expandedOption = null"
      >
        <div class="bg-white rounded-xl shadow-2xl flex flex-col" style="width:90vw;height:82vh;max-width:1200px">
          <div class="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
            <span class="text-sm font-semibold text-slate-700">📈 圖表</span>
            <button
              type="button"
              class="text-slate-400 hover:text-slate-700 transition text-xl leading-none px-1"
              @click="expandedOption = null"
            >✕</button>
          </div>
          <!-- Inner div has explicit pixel height so VChart height:100% resolves correctly -->
          <div class="flex-1 px-4 pb-4 pt-2 qm-modal-chart-wrap">
            <VChart
              :option="chartOption(expandedOption)"
              autoresize
              class="qm-modal-chart"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Inline chart: explicit pixel height on the VChart root element */
.qm-inline-chart {
  display: block;
  width: 100%;
  height: 300px;
}

/* Modal chart wrapper: fill remaining height after header */
.qm-modal-chart-wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Modal chart: fill the flex parent */
.qm-modal-chart {
  display: block;
  width: 100%;
  flex: 1;
  min-height: 0;
}
</style>

