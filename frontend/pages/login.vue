<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NCard, NForm, NFormItem, NInput, useMessage } from 'naive-ui'
import { useAuthStore } from '../stores/auth'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ layout: false })

const auth = useAuthStore()
const route = useRoute()
const message = useMessage()

const form = reactive({
  email: 'owner@local',
  password: '',
})

async function onSubmit() {
  if (!form.email || !form.password) {
    message.warning('請輸入帳號與密碼')
    return
  }
  try {
    await auth.login(form.email, form.password)
    message.success('登入成功')
    const redirect = (route.query.redirect as string) || '/home'
    // Hard navigation：讓 Nuxt 完全重新初始化，從 localStorage 讀取已持久化的 token。
    // 這可避免 SPA route middleware 在 async await 後 reactive context 失效的問題。
    setTimeout(() => { window.location.replace(redirect) }, 400)
  } catch (err: unknown) {
    const detail = (err as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (err as { message?: string })?.message
      ?? '登入失敗'
    message.error(detail)
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-50">
    <NCard
      class="w-[420px] shadow-xl"
      :bordered="false"
      header-style="padding-bottom:0"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-brand-500 text-white grid place-items-center font-bold">QM</div>
          <div>
            <div class="text-lg font-semibold">QueryMind</div>
            <div class="text-xs text-slate-500">請使用你的帳號登入</div>
          </div>
        </div>
      </template>

      <NForm @submit.prevent="onSubmit">
        <NFormItem label="Email">
          <NInput v-model:value="form.email" placeholder="you@example.com" autofocus />
        </NFormItem>
        <NFormItem label="密碼">
          <NInput
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            placeholder="請輸入密碼"
            @keyup.enter="onSubmit"
          />
        </NFormItem>
        <NButton
          type="primary"
          block
          :loading="auth.loading"
          attr-type="submit"
        >
          登入
        </NButton>
      </NForm>

      <div class="mt-6 text-xs text-slate-400 leading-relaxed">
        預設帳號：<code>owner@local</code> / <code>Owner123!</code><br />
        （請在首次登入後立即修改密碼）
      </div>
    </NCard>
  </div>
</template>
