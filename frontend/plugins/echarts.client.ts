/**
 * Register ECharts once globally on the client.
 * This avoids per-component dynamic imports and the async-boundary / height-0 bug
 * that occurs when defineAsyncComponent + ClientOnly both delay mount.
 */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  GaugeChart,
  FunnelChart,
} from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DatasetComponent,
  ToolboxComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'

export default defineNuxtPlugin((nuxtApp) => {
  use([
    CanvasRenderer,
    BarChart, LineChart, PieChart, ScatterChart, RadarChart, GaugeChart, FunnelChart,
    TitleComponent, TooltipComponent, LegendComponent, GridComponent,
    DatasetComponent, ToolboxComponent, DataZoomComponent,
    MarkAreaComponent, MarkLineComponent,
  ])
  nuxtApp.vueApp.component('VChart', VChart)
})
