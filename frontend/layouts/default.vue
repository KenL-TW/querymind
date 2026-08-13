<script setup lang="ts">
import {
  NAvatar, NButton, NDropdown, NForm, NFormItem, NIcon, NInput, NLayout,
  NLayoutHeader, NLayoutSider, NMenu, NModal, type MenuOption, useMessage,
} from 'naive-ui'
import { computed, h, ref, resolveComponent } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const api = useApi()
const route = useRoute()
const message = useMessage()

const collapsed = ref(false)

// resolveComponent must be called in setup scope; NuxtLink is globally registered
// but NOT available as a plain JS variable — must use resolveComponent()
const NuxtLinkComp = resolveComponent('NuxtLink')

const menuOptions = computed<MenuOption[]>(() => {
  const items: MenuOption[] = [
    { label: () => h(NuxtLinkComp, { to: '/home' }, () => '首頁'),       key: '/home' },
    { label: () => h(NuxtLinkComp, { to: '/chat' }, () => 'Chat'),           key: '/chat' },
    { label: () => h(NuxtLinkComp, { to: '/schema' }, () => 'Schema'),         key: '/schema' },
    { label: () => h(NuxtLinkComp, { to: '/dictionary' }, () => '資料字典'),  key: '/dictionary' },
    { label: () => h(NuxtLinkComp, { to: '/templates' }, () => '樣板'),       key: '/templates' },
    { label: () => h(NuxtLinkComp, { to: '/insights' }, () => '收藏'), key: '/insights' },
    { label: () => h(NuxtLinkComp, { to: '/me/usage' }, () => '我的用量'), key: '/me/usage' },
  ]
  if (auth.hasCapability('manage_users')) {
    items.push({ label: () => h(NuxtLinkComp, { to: '/admin' }, () => '管理'), key: '/admin' })
  }
  return items
})

const userMenuOptions = [
  { label: '變更密碼', key: 'change-password' },
  { label: '登出', key: 'logout' },
]

// ── Change Password Modal ────────────────────────────────────────────────────
const showChangePwd = ref(false)
const changePwd = ref({ current: '', next: '', confirm: '' })
const changePwdLoading = ref(false)

async function submitChangePwd() {
  if (changePwd.value.next.length < 8) {
    message.warning('新密碼至少需要 8 個字元')
    return
  }
  if (changePwd.value.next !== changePwd.value.confirm) {
    message.warning('兩次輸入的密碼不一致')
    return
  }
  changePwdLoading.value = true
  try {
    await api.post('/v1/auth/change-password', {
      current_password: changePwd.value.current,
      new_password: changePwd.value.next,
    })
    message.success('密碼已更新')
    showChangePwd.value = false
    changePwd.value = { current: '', next: '', confirm: '' }
  } catch (e: unknown) {
    message.error(
      (e as { data?: { detail?: string }; message?: string })?.data?.detail
        ?? '密碼變更失敗，請確認舊密碼是否正確',
    )
  } finally {
    changePwdLoading.value = false
  }
}
// ────────────────────────────────────────────────────────────────────────────

function onUserMenu(key: string) {
  if (key === 'logout') auth.logout()
  if (key === 'change-password') showChangePwd.value = true
}

const activeKey = computed(() => {
  const p = route.path
  // 多層路徑（如 /admin/users）映射回頂層
  const top = '/' + (p.split('/')[1] || '')
  return menuOptions.value.find((m) => m.key === top) ? top : p
})
</script>

<template>
  <NLayout has-sider class="h-screen">
    <NLayoutSider
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="220"
      :collapsed="collapsed"
      show-trigger
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div class="px-4 py-5 text-lg font-semibold text-brand-600">
        <span v-if="!collapsed">QueryMind</span>
        <span v-else>QM</span>
      </div>
      <NMenu
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        :value="activeKey"
      />
    </NLayoutSider>

    <NLayout>
      <NLayoutHeader bordered class="flex items-center justify-between px-6 h-14 bg-white">
        <div class="text-sm text-slate-500">
          {{ route.meta?.title ?? '' }}
        </div>
        <NDropdown :options="userMenuOptions" trigger="click" @select="onUserMenu">
          <div class="flex items-center gap-3 cursor-pointer select-none">
            <NAvatar round size="small" :style="{ background: '#2080f0' }">
              {{ (auth.me?.display_name || auth.me?.email || '?').slice(0, 1).toUpperCase() }}
            </NAvatar>
            <div class="flex flex-col leading-tight">
              <span class="text-sm font-medium">{{ auth.me?.display_name || auth.me?.email }}</span>
              <span class="text-xs text-slate-500">{{ auth.role }}</span>
            </div>
          </div>
        </NDropdown>
      </NLayoutHeader>

      <NLayout content-style="padding: 24px;">
        <slot />
      </NLayout>

      <!-- 變更密碼 Modal (inside NLayout so there is a single template root) -->
      <NModal v-model:show="showChangePwd" preset="card" title="變更密碼" class="!w-[420px]" :mask-closable="false">
        <NForm @submit.prevent="submitChangePwd">
          <NFormItem label="目前密碼">
            <NInput
              v-model:value="changePwd.current"
              type="password"
              show-password-on="click"
              placeholder="請輸入目前密碼"
              :disabled="changePwdLoading"
            />
          </NFormItem>
          <NFormItem label="新密碼">
            <NInput
              v-model:value="changePwd.next"
              type="password"
              show-password-on="click"
              placeholder="至少 8 個字元"
              :disabled="changePwdLoading"
            />
          </NFormItem>
          <NFormItem label="確認新密碼">
            <NInput
              v-model:value="changePwd.confirm"
              type="password"
              show-password-on="click"
              placeholder="再次輸入新密碼"
              :disabled="changePwdLoading"
            />
          </NFormItem>
          <div class="flex justify-end gap-2 mt-2">
            <NButton @click="showChangePwd = false" :disabled="changePwdLoading">取消</NButton>
            <NButton type="primary" attr-type="submit" :loading="changePwdLoading">確認變更</NButton>
          </div>
        </NForm>
      </NModal>
    </NLayout>
  </NLayout>
</template>
