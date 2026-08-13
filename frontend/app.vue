<script setup lang="ts">
import { darkTheme, lightTheme, NConfigProvider, NDialogProvider, NLoadingBarProvider, NMessageProvider, NNotificationProvider, zhTW, dateZhTW } from 'naive-ui'

const theme = ref<'light' | 'dark'>('light')
const themeOverrides = {
  common: {
    primaryColor: '#2080f0',
    primaryColorHover: '#4098fc',
    primaryColorPressed: '#1968d4',
    borderRadius: '8px',
  },
}
</script>

<template>
  <NConfigProvider
    :theme="theme === 'dark' ? darkTheme : lightTheme"
    :theme-overrides="themeOverrides"
    :locale="zhTW"
    :date-locale="dateZhTW"
  >
    <NLoadingBarProvider>
      <NMessageProvider>
        <NNotificationProvider>
          <NDialogProvider>
            <NuxtLayout>
              <NuxtPage />
            </NuxtLayout>
          </NDialogProvider>
        </NNotificationProvider>
      </NMessageProvider>
    </NLoadingBarProvider>
  </NConfigProvider>
</template>
