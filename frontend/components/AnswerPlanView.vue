<script setup lang="ts">
import { computed } from 'vue'

type AnswerPlan = {
  answer_type?: string
  row_count?: number
  table?: boolean
  chart_type?: string
  chart_x?: string
  chart_y?: string
  columns?: string[]
  preview_rows?: Array<Record<string, unknown>>
  summary_points?: string[]
  warnings?: string[]
  next_actions?: string[]
}

const props = defineProps<{
  plan?: AnswerPlan | Record<string, unknown> | null
}>()

const plan = computed<AnswerPlan>(() => (props.plan ?? {}) as AnswerPlan)
const rows = computed(() => Array.isArray(plan.value.preview_rows) ? plan.value.preview_rows : [])
const columns = computed(() => {
  if (Array.isArray(plan.value.columns) && plan.value.columns.length > 0) return plan.value.columns
  const first = rows.value[0]
  return first ? Object.keys(first) : []
})
const summaryPoints = computed(() => Array.isArray(plan.value.summary_points) ? plan.value.summary_points : [])
const nextActions = computed(() => Array.isArray(plan.value.next_actions) ? plan.value.next_actions : [])
const warnings = computed(() => Array.isArray(plan.value.warnings) ? plan.value.warnings : [])
const rowCount = computed(() => Number(plan.value.row_count ?? rows.value.length ?? 0))
const chartType = computed(() => String(plan.value.chart_type ?? 'table'))
const shouldRender = computed(() => {
  return rowCount.value > 0 || summaryPoints.value.length > 0 || nextActions.value.length > 0 || warnings.value.length > 0
})
const shouldShowChart = computed(() => {
  return ['bar', 'line', 'pie'].includes(chartType.value) && rows.value.length > 0 && !!plan.value.chart_x && !!plan.value.chart_y
})
const visibleRows = computed(() => rows.value.slice(0, 20))

const chartOption = computed(() => {
  if (!shouldShowChart.value) return {}
  const xKey = String(plan.value.chart_x)
  const yKey = String(plan.value.chart_y)
  const labels = rows.value.map(row => formatCell(row[xKey]))
  const values = rows.value.map(row => toNumber(row[yKey]))

  if (chartType.value === 'pie') {
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, type: 'scroll' },
      series: [{
        type: 'pie',
        radius: ['42%', '72%'],
        data: labels.map((name, index) => ({ name, value: values[index] })),
      }],
    }
  }

  return {
    tooltip: { trigger: 'axis' },
    grid: { top: 24, left: 48, right: 16, bottom: 56 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { interval: 0, rotate: labels.some(label => label.length > 8) ? 28 : 0 },
    },
    yAxis: { type: 'value' },
    series: [{
      type: chartType.value === 'line' ? 'line' : 'bar',
      smooth: chartType.value === 'line',
      data: values,
      barMaxWidth: 36,
    }],
  }
})

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}
</script>

<template>
  <div v-if="shouldRender" class="answer-plan mt-3">
    <div class="answer-plan__head">
      <div>
        <div class="answer-plan__title">查詢結果</div>
        <div class="answer-plan__meta">{{ rowCount.toLocaleString() }} 筆資料</div>
      </div>
      <span v-if="chartType !== 'none'" class="answer-plan__mode">{{ chartType }}</span>
    </div>

    <div v-if="shouldShowChart" class="answer-plan__chart">
      <VChart :option="chartOption" autoresize class="answer-plan__chart-canvas" />
    </div>

    <div v-if="columns.length && visibleRows.length" class="answer-plan__table-wrap">
      <table class="answer-plan__table">
        <thead>
          <tr>
            <th v-for="col in columns" :key="col">{{ col }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in visibleRows" :key="ri">
            <td v-for="col in columns" :key="col">{{ formatCell(row[col]) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="summaryPoints.length || nextActions.length" class="answer-plan__notes">
      <div v-for="(item, idx) in summaryPoints" :key="`s-${idx}`">{{ item }}</div>
      <div v-for="(item, idx) in nextActions" :key="`n-${idx}`" class="answer-plan__next">{{ item }}</div>
    </div>
  </div>
</template>

<style scoped>
.answer-plan {
  overflow: hidden;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #fff;
}

.answer-plan__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #e6edf5;
  background: #f8fafc;
}

.answer-plan__title {
  font-size: 13px;
  font-weight: 700;
  color: #1f2937;
}

.answer-plan__meta,
.answer-plan__mode {
  font-size: 12px;
  color: #64748b;
}

.answer-plan__mode {
  padding: 2px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #fff;
}

.answer-plan__chart {
  padding: 10px 12px 0;
}

.answer-plan__chart-canvas {
  width: 100%;
  height: 280px;
}

.answer-plan__table-wrap {
  max-height: 320px;
  overflow: auto;
  border-top: 1px solid #eef2f7;
}

.answer-plan__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.answer-plan__table th,
.answer-plan__table td {
  max-width: 220px;
  padding: 8px 10px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid #eef2f7;
}

.answer-plan__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  font-weight: 700;
  color: #475569;
  background: #f8fafc;
}

.answer-plan__notes {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  font-size: 12px;
  color: #475569;
  border-top: 1px solid #eef2f7;
}

.answer-plan__next {
  color: #0369a1;
}
</style>
