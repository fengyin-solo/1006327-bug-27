<template>
  <section class="page" data-module="maintenance">
    <header class="page-head">
      <div>
        <h2>设施检修管理</h2>
        <p class="page-desc">维护检修记录。结构沉降超限断面自动生成「沉降预警联动」待办，按最新累计沉降量从大到小置顶重排。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出设施检修清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">沉降预警联动待办：{{ syncedPending }} 条（按沉降值降序置顶）</span>
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>来源</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-warn': row.来源 === '沉降预警联动' && row.status === '待开工' }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '检修对象'">
              {{ row[column] ?? '—' }}
              <span v-if="row.来源 === '沉降预警联动'" class="tag tag-arch">沉降预警联动</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.来源 ?? '人工登记' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无设施检修数据，可先登记检修记录</td>
        </tr>
      </tbody>
    </table>

    <section v-if="ledger.length" class="sub-panel">
      <h3>异常待查台账（与结构沉降监测、运营概览同源，读数一致）</h3>
      <table class="data-table">
        <thead>
          <tr><th>监测断面</th><th>监测编号</th><th>读数日期</th><th>累计沉降量(mm)</th><th>沉降速率(mm/d)</th><th>异常结论</th><th>来源</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, idx) in ledger" :key="`${item.code}-${idx}`">
            <td>{{ item.section }}</td>
            <td>{{ item.code }}</td>
            <td>{{ item.date }}</td>
            <td>{{ formatNumber(item.cumulative, 1) }}</td>
            <td>{{ formatNumber(item.rate, 2) }}</td>
            <td>{{ item.conclusion }}</td>
            <td>{{ item.source }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条检修记录（导出顺序与本页一致）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadRowsCsv, filterRows, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { listMaintenanceRows, listReviewLedger } from '@/api/settlement-service'
import type { EntryRow } from '@/data/types'
import type { ReviewItem } from '@/data/settlement-types'

const meta = moduleMeta('maintenance')
const columns = ['检修编号', '检修对象', '检修类别', '检修班组', '计划工期', '完工日期', '更换部件', '检修状态']
const actions = ['提交开工', '确认完工', '申请延期']
const statuses = ['待开工', '检修中', '已完工', '已延期']
const stats = [
  { label: '待开工检修', value: 0 },
  { label: '检修中记录', value: 0 },
  { label: '沉降联动待办', value: 0 },
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const ledger = ref<ReviewItem[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const syncedPending = computed(
  () => rows.value.filter((row) => row.来源 === '沉降预警联动' && row.status === '待开工').length,
)

function formatNumber(value: number, digits: 1 | 2): string {
  const factor = digits === 1 ? 10 : 100
  return String(Math.round((value + Number.EPSILON) * factor) / factor)
}

// 统计卡与台账按全量算，表格按筛选条件过滤；行序沿用统一口径（沉降联动置顶降序）。
function refreshStats(all: EntryRow[]) {
  stats[0].value = all.filter((r) => r.status === '待开工').length
  stats[1].value = all.filter((r) => r.status === '检修中').length
  stats[2].value = all.filter((r) => r.来源 === '沉降预警联动' && r.status === '待开工').length
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  // 导出与页面完全同一份行序列表（含筛选与置顶排序），报表与明细清单对得上。
  downloadRowsCsv(meta.name, columns, rows.value, ['来源'])
}

function openCreate() {
  errorMessage.value = '检修记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    ledger.value = listReviewLedger()
    const all = listMaintenanceRows()
    refreshStats(all)
    const matched = filterRows(all, filters.value)
    rows.value = matched
    total.value = matched.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设施检修管理列表读取失败'
  }
}

onMounted(reload)
</script>
