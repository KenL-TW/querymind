<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, NSpace, NSpin, NTag, useMessage } from 'naive-ui'
import { useApi } from '../composables/useApi'
import { useAuthStore } from '../stores/auth'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ layout: false })

interface InvitePreview {
  valid: boolean
  email: string
  role: string
  allowed_conns: string[]
  expires_at?: string | null
}

const message = useMessage()
const route = useRoute()
const api = useApi()
const auth = useAuthStore()

const token = ref(String(route.query.token ?? ''))
const preview = ref<InvitePreview | null>(null)
const previewError = ref('')
const previewLoading = ref(false)
const form = reactive({ display_name: '', password: '', confirm: '' })
const done = ref(false)

const canSubmit = computed(() => {
  return !!token.value && !!preview.value?.valid && form.password.length >= 8 && form.password === form.confirm && !auth.loading
})
const passwordHint = computed(() => {
  if (!form.password) return '至少 8 個字元'
  if (form.password.length < 8) return '密碼太短'
  if (form.password !== form.confirm && form.confirm) return '兩次密碼不一致'
  return '密碼可用'
})
const inviteUrlToken = computed(() => normalizeInviteToken(token.value))

watch(() => route.query.token, (next) => {
  token.value = String(next ?? '')
  void loadPreview()
})

onMounted(loadPreview)

async function loadPreview() {
  preview.value = null
  previewError.value = ''
  const raw = inviteUrlToken.value
  if (!raw) {
    previewError.value = '請貼上管理者提供的邀請連結或邀請 token。'
    return
  }
  previewLoading.value = true
  try {
    preview.value = await api.get<InvitePreview>(`/v1/auth/invite/${encodeURIComponent(raw)}`)
  } catch (e: unknown) {
    previewError.value = (e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message
      ?? '邀請不存在、已過期或已使用。'
  } finally {
    previewLoading.value = false
  }
}

async function onSubmit() {
  if (!canSubmit.value) {
    message.warning(passwordHint.value)
    return
  }
  try {
    await auth.acceptInvite(inviteUrlToken.value, form.password, form.display_name)
    done.value = true
    message.success('帳號已建立，正在進入 QueryMind')
    setTimeout(() => { window.location.replace('/home') }, 400)
  } catch (e: unknown) {
    const detail = (e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message
      ?? '邀請碼無效或已過期'
    message.error(detail)
  }
}

function normalizeInviteToken(raw: string): string {
  const value = (raw || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value, import.meta.client ? window.location.origin : 'http://localhost')
    return parsed.searchParams.get('token') || value
  } catch {
    return value
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-8">
    <NCard class="w-full max-w-[480px] shadow-xl" :bordered="false">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded bg-brand-500 text-white grid place-items-center font-bold">QM</div>
          <div>
            <div class="text-lg font-semibold text-slate-900">加入 QueryMind</div>
            <div class="text-xs text-slate-500">接受邀請並設定你的登入密碼</div>
          </div>
        </div>
      </template>

      <NSpin :show="previewLoading">
        <NAlert v-if="done" type="success" class="mb-4">
          帳號建立成功，正在進入工作區。
        </NAlert>

        <NAlert v-else-if="previewError" type="warning" class="mb-4">
          {{ previewError }}
        </NAlert>

        <div class="space-y-4">
          <NForm label-placement="top" @submit.prevent="onSubmit">
            <NFormItem label="邀請 token">
              <NInput
                v-model:value="token"
                placeholder="貼上 inv_... token 或使用完整邀請連結"
                :disabled="auth.loading || done"
                @blur="loadPreview"
                @keyup.enter="loadPreview"
              />
            </NFormItem>

            <div v-if="preview?.valid" class="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="font-medium text-slate-800">{{ preview.email }}</div>
                  <div class="text-xs text-slate-500 mt-0.5">
                    到期時間：{{ preview.expires_at || '未設定' }}
                  </div>
                </div>
                <NTag size="small" type="info" :bordered="false">{{ preview.role }}</NTag>
              </div>
              <div class="mt-2">
                <div class="text-xs text-slate-500 mb-1">可用資料連線</div>
                <NSpace size="small">
                  <NTag
                    v-for="conn in preview.allowed_conns.length ? preview.allowed_conns : ['全部連線']"
                    :key="conn"
                    size="small"
                    :bordered="false"
                  >
                    {{ conn }}
                  </NTag>
                </NSpace>
              </div>
            </div>

            <NFormItem label="顯示名稱">
              <NInput
                v-model:value="form.display_name"
                placeholder="你的名字或團隊暱稱"
                :disabled="auth.loading || done || !preview?.valid"
              />
            </NFormItem>
            <NFormItem label="設定密碼">
              <NInput
                v-model:value="form.password"
                type="password"
                show-password-on="click"
                placeholder="至少 8 個字元"
                :disabled="auth.loading || done || !preview?.valid"
              />
            </NFormItem>
            <NFormItem label="確認密碼">
              <NInput
                v-model:value="form.confirm"
                type="password"
                show-password-on="click"
                placeholder="再次輸入密碼"
                :disabled="auth.loading || done || !preview?.valid"
                @keyup.enter="onSubmit"
              />
            </NFormItem>

            <div class="text-xs mb-3" :class="passwordHint === '密碼可用' ? 'text-emerald-600' : 'text-slate-500'">
              {{ passwordHint }}
            </div>

            <NButton
              type="primary"
              block
              attr-type="submit"
              :loading="auth.loading"
              :disabled="!canSubmit || done"
            >
              建立帳號並進入工作區
            </NButton>
          </NForm>

          <div class="text-xs text-slate-500 text-center">
            已有帳號？
            <NuxtLink to="/login" class="text-blue-600 hover:underline">前往登入</NuxtLink>
          </div>
        </div>
      </NSpin>
    </NCard>
  </div>
</template>
