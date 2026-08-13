<script setup lang="ts">
import { NButton, NCard, NTag } from 'naive-ui'

declare const clearError: (opts?: { redirect?: string }) => Promise<void>

interface NuxtErrorLike {
  statusCode?: number
  statusMessage?: string
  message?: string
  stack?: string
  url?: string
}

const props = defineProps<{ error: NuxtErrorLike }>()

function handleReload() {
  if (typeof window !== 'undefined') window.location.reload()
}
async function handleHome() {
  await clearError({ redirect: '/' })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6 bg-slate-50">
    <NCard class="!w-[560px] shadow-md" :title="`頁面發生錯誤${props.error?.statusCode ? ` (${props.error.statusCode})` : ''}`">
      <div class="space-y-3 text-sm">
        <div class="flex items-center gap-2">
          <NTag type="error" :bordered="false">{{ props.error?.statusMessage || 'Error' }}</NTag>
          <span class="text-slate-500 break-all">{{ props.error?.url }}</span>
        </div>
        <div class="text-slate-700">
          {{ props.error?.message || '未知錯誤，請嘗試重新整理或返回首頁。' }}
        </div>
        <details v-if="props.error?.stack" class="text-xs text-slate-500">
          <summary class="cursor-pointer">技術細節</summary>
          <pre class="mt-2 whitespace-pre-wrap break-all">{{ props.error.stack }}</pre>
        </details>
        <div class="flex gap-2 pt-2">
          <NButton type="primary" @click="handleReload">重新載入</NButton>
          <NButton @click="handleHome">返回首頁</NButton>
        </div>
        <div class="text-xs text-slate-400 pt-2 border-t">
          常見原因：前端 bundle 已更新但瀏覽器仍持有舊版本 → 請按
          <code class="px-1 bg-slate-100 rounded">Ctrl+Shift+R</code> 強制重新整理。
        </div>
      </div>
    </NCard>
  </div>
</template>
