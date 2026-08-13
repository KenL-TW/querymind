<script setup lang="ts">
import { computed, ref } from 'vue'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ layout: false, title: 'QueryMind' })

const previewTabs = ['Ask', 'SQL', 'Chart'] as const
type PreviewTab = (typeof previewTabs)[number]
const activeTab = ref<PreviewTab>('Ask')

const previewCopy = computed(() => {
  if (activeTab.value === 'SQL') {
    return {
      title: 'Validated SQL',
      body: 'SELECT region, SUM(revenue) FROM orders WHERE quarter = Q2 GROUP BY region;',
      note: 'Read-only warehouse role, row limit enforced',
    }
  }
  if (activeTab.value === 'Chart') {
    return {
      title: 'Revenue by region',
      body: 'North 42%  East 28%  West 18%  South 12%',
      note: 'Export as CSV, PNG, or scheduled brief',
    }
  }
  return {
    title: 'Natural language request',
    body: 'Show Q2 revenue by region and flag segments with unusual margin changes.',
    note: 'QueryMind maps terms to your schema and business dictionary',
  }
})

const workflow = [
  {
    title: 'Connect your warehouse',
    body: 'Register Postgres, MySQL, or analytics replicas with scoped credentials and metadata sync.',
  },
  {
    title: 'Ask in plain language',
    body: 'The agent reads schema context, dictionary terms, and prior analysis patterns before drafting SQL.',
  },
  {
    title: 'Validate before execution',
    body: 'Review joins, filters, row limits, and policy checks before the query touches production data.',
  },
  {
    title: 'Export the insight',
    body: 'Turn answers into charts, reusable templates, scheduled reports, or team-ready notes.',
  },
]

const securityItems = [
  'Role-based access for owners, analysts, and viewers',
  'Audit log for prompts, SQL, exports, and admin actions',
  'API boundaries that keep credentials out of generated output',
]
</script>

<template>
  <main class="min-h-screen bg-white text-slate-950">
    <header class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/92 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <NuxtLink to="/" class="flex items-center gap-3" aria-label="QueryMind home">
          <span class="grid h-9 w-9 place-items-center rounded-lg bg-slate-950 text-sm font-bold text-white shadow-sm">QM</span>
          <span class="text-lg font-semibold tracking-normal">QueryMind</span>
        </NuxtLink>
        <nav class="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
          <a href="#product" class="transition hover:text-slate-950">Product</a>
          <a href="#workflow" class="transition hover:text-slate-950">Workflow</a>
          <a href="#security" class="transition hover:text-slate-950">Security</a>
          <NuxtLink to="/login" class="transition hover:text-slate-950">Sign in</NuxtLink>
        </nav>
        <NuxtLink
          to="/login"
          class="inline-flex h-10 items-center justify-center rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#115e59] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30"
        >
          Start querying
        </NuxtLink>
      </div>
    </header>

    <section id="product" class="relative overflow-hidden">
      <div class="absolute inset-x-0 top-0 h-[520px] bg-[linear-gradient(#e2e8f0_1px,transparent_1px),linear-gradient(90deg,#e2e8f0_1px,transparent_1px)] bg-[size:48px_48px] opacity-40" />
      <div class="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:py-20">
        <div class="max-w-3xl">
          <h1 class="max-w-3xl text-balance text-5xl font-semibold leading-[0.98] tracking-normal text-slate-950 sm:text-6xl lg:text-7xl">
            Ask your database like a teammate.
          </h1>
          <p class="mt-7 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
            QueryMind turns natural language into governed SQL, charts, and reusable analysis workflows for teams that move faster than dashboards.
          </p>
          <div class="mt-9 flex flex-col gap-3 sm:flex-row">
            <NuxtLink
              to="/login"
              class="inline-flex h-12 items-center justify-center rounded-lg bg-slate-950 px-6 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950/25"
            >
              Start querying
            </NuxtLink>
            <a
              href="#workflow"
              class="inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-950/10"
            >
              View demo
            </a>
          </div>
        </div>

        <div class="relative">
          <div class="absolute -left-5 top-10 hidden h-28 w-2 rounded-full bg-[#14b8a6] lg:block" />
          <div class="rounded-lg border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
            <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div class="flex items-center gap-2">
                <span class="h-3 w-3 rounded-full bg-[#ef4444]" />
                <span class="h-3 w-3 rounded-full bg-[#f59e0b]" />
                <span class="h-3 w-3 rounded-full bg-[#10b981]" />
              </div>
              <div class="text-xs font-medium text-slate-500">workspace.querymind.local</div>
            </div>

            <div class="grid min-h-[460px] md:grid-cols-[190px_1fr]">
              <aside class="border-b border-slate-200 bg-slate-50 p-4 md:border-b-0 md:border-r">
                <div class="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Sources</div>
                <div class="space-y-2">
                  <div class="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm">Revenue DB</div>
                  <div class="rounded-lg px-3 py-2 text-sm text-slate-500">Product events</div>
                  <div class="rounded-lg px-3 py-2 text-sm text-slate-500">Support tickets</div>
                </div>
                <div class="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Policy</div>
                <div class="mt-3 space-y-3 text-xs text-slate-600">
                  <div class="flex items-center gap-2">
                    <span class="h-2 w-2 rounded-full bg-[#0f766e]" />
                    Viewer safe
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="h-2 w-2 rounded-full bg-[#2563eb]" />
                    Audit enabled
                  </div>
                </div>
              </aside>

              <div class="p-5 sm:p-6">
                <div class="mb-5 flex flex-wrap items-center gap-2">
                  <button
                    v-for="tab in previewTabs"
                    :key="tab"
                    type="button"
                    class="h-9 rounded-lg px-4 text-sm font-semibold transition"
                    :class="activeTab === tab ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                    @click="activeTab = tab"
                  >
                    {{ tab }}
                  </button>
                </div>

                <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div class="mb-3 text-sm font-semibold text-slate-500">{{ previewCopy.title }}</div>
                  <p class="min-h-[96px] rounded-lg bg-white p-4 font-mono text-sm leading-7 text-slate-800 shadow-sm">
                    {{ previewCopy.body }}
                  </p>
                  <div class="mt-3 text-xs font-medium text-[#0f766e]">{{ previewCopy.note }}</div>
                </div>

                <div class="mt-5 grid gap-3 sm:grid-cols-2">
                  <div class="rounded-lg border border-slate-200 p-4">
                    <div class="mb-4 flex items-center justify-between">
                      <span class="text-sm font-semibold text-slate-900">Validation</span>
                      <span class="text-xs font-semibold text-[#0f766e]">Ready</span>
                    </div>
                    <div class="space-y-3 text-sm text-slate-600">
                      <div class="flex gap-2"><span class="text-[#0f766e]">✓</span> Row limit applied</div>
                      <div class="flex gap-2"><span class="text-[#0f766e]">✓</span> Join path verified</div>
                      <div class="flex gap-2"><span class="text-[#0f766e]">✓</span> PII fields excluded</div>
                    </div>
                  </div>
                  <div class="rounded-lg border border-slate-200 p-4">
                    <div class="mb-4 text-sm font-semibold text-slate-900">Insight preview</div>
                    <div class="flex h-24 items-end gap-2">
                      <span class="w-1/4 rounded-t bg-[#0f766e]" style="height: 74%" />
                      <span class="w-1/4 rounded-t bg-[#2563eb]" style="height: 52%" />
                      <span class="w-1/4 rounded-t bg-[#38bdf8]" style="height: 38%" />
                      <span class="w-1/4 rounded-t bg-slate-300" style="height: 24%" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="workflow" class="border-y border-slate-200 bg-slate-50">
      <div class="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <div class="grid gap-10 lg:grid-cols-[0.45fr_1fr]">
          <div>
            <h2 class="text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">From question to reusable analysis.</h2>
            <p class="mt-5 text-base leading-7 text-slate-600">
              QueryMind keeps each step visible, reviewable, and repeatable so teams can move quickly without bypassing database discipline.
            </p>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <article
              v-for="(item, index) in workflow"
              :key="item.title"
              class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div class="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-sm font-bold text-white">
                {{ index + 1 }}
              </div>
              <h3 class="text-lg font-semibold text-slate-950">{{ item.title }}</h3>
              <p class="mt-3 text-sm leading-6 text-slate-600">{{ item.body }}</p>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section id="security" class="bg-white">
      <div class="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_0.9fr]">
        <div class="rounded-lg border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div class="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <div class="text-sm font-semibold">Governance console</div>
              <div class="mt-1 text-xs text-slate-400">Live audit boundary</div>
            </div>
            <span class="rounded bg-[#14b8a6] px-2 py-1 text-xs font-bold text-slate-950">ACTIVE</span>
          </div>
          <div class="space-y-3">
            <div class="grid grid-cols-[100px_1fr_90px] gap-3 rounded-lg bg-white/6 p-3 text-xs text-slate-300">
              <span>analyst</span><span>Generated SQL for revenue by region</span><span class="text-[#5eead4]">Allowed</span>
            </div>
            <div class="grid grid-cols-[100px_1fr_90px] gap-3 rounded-lg bg-white/6 p-3 text-xs text-slate-300">
              <span>viewer</span><span>Requested customer-level export</span><span class="text-[#fca5a5]">Blocked</span>
            </div>
            <div class="grid grid-cols-[100px_1fr_90px] gap-3 rounded-lg bg-white/6 p-3 text-xs text-slate-300">
              <span>owner</span><span>Updated database connection scope</span><span class="text-[#5eead4]">Logged</span>
            </div>
          </div>
        </div>

        <div class="flex flex-col justify-center">
          <h2 class="text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">Built for governed self-serve analytics.</h2>
          <p class="mt-5 text-base leading-7 text-slate-600">
            Give teams a natural-language interface without losing visibility into who asked what, which SQL ran, and where results moved.
          </p>
          <ul class="mt-8 space-y-4">
            <li v-for="item in securityItems" :key="item" class="flex gap-3 text-sm leading-6 text-slate-700">
              <span class="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded bg-[#ccfbf1] text-xs font-bold text-[#0f766e]">✓</span>
              <span>{{ item }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="bg-slate-950 text-white">
      <div class="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-16 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 class="text-3xl font-semibold tracking-normal">Put your database in the conversation.</h2>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Start with a local demo, connect a read-only source, and turn repeated analysis into governed workflows.
          </p>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row">
          <NuxtLink to="/login" class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100">
            Start querying
          </NuxtLink>
          <a href="#product" class="inline-flex h-11 items-center justify-center rounded-lg border border-white/20 px-5 text-sm font-semibold text-white transition hover:border-white/50">
            View demo
          </a>
        </div>
      </div>
    </section>

    <footer class="border-t border-slate-200 bg-white">
      <div class="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div class="font-semibold text-slate-900">QueryMind</div>
        <div>AI-powered database agent for governed team analytics.</div>
      </div>
    </footer>
  </main>
</template>
