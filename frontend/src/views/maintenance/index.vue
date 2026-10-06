<template>
  <section class="page" data-module="maintenance">
    <header class="page-head">
      <div>
        <h2>设施检修管理</h2>
        <p class="page-desc">
          维护检修记录；结构沉降超限预警自动同步为沉降专项待办（一断面一条），按最新累计沉降值降序排队，
          断面恢复正常后自动关闭。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出设施检修管理清单</button>
        <button class="btn ghost" type="button" @click="resync">按最新沉降值重排</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>检修编号/对象</span>
        <input v-model="keyword" placeholder="按检修编号或检修对象检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="keyword = ''; reload()">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>检修编号</th>
          <th>检修对象</th>
          <th>检修类别</th>
          <th>检修班组</th>
          <th>累计沉降量(mm)</th>
          <th>沉降速率(mm/d)</th>
          <th>阈值(mm)</th>
          <th>取值来源</th>
          <th>最近观测</th>
          <th>检修优先级</th>
          <th>来源</th>
          <th>计划工期</th>
          <th>完工日期</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filtered" :key="String(row.id)" :class="{ 'row-synced': row['关联断面'] }">
          <td>{{ row['检修编号'] }}</td>
          <td>{{ row['检修对象'] }}</td>
          <td>{{ row['检修类别'] }}</td>
          <td>{{ row['检修班组'] }}</td>
          <td class="num">{{ row['累计沉降量mm'] ?? '—' }}</td>
          <td class="num">{{ row['沉降速率'] ?? '—' }}</td>
          <td class="num">{{ row['预警阈值mm'] ?? '—' }}</td>
          <td>{{ row['数值来源'] ?? '—' }}</td>
          <td>{{ row['最近观测日期'] ?? '—' }}</td>
          <td>
            <span v-if="row['检修优先级']" class="priority" :class="`p-${row['检修优先级']}`">{{ row['检修优先级'] }}</span>
            <span v-else>—</span>
          </td>
          <td>{{ row['来源'] ?? '手工登记' }}</td>
          <td>{{ row['计划工期'] }}</td>
          <td>{{ row['完工日期'] }}</td>
          <td>
            <span class="status-badge" :class="row.status === '已关闭' ? 'badge-closed' : row.abnormal ? 'badge-warning' : 'badge-normal'">
              {{ row.status }}
            </span>
          </td>
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
        <tr v-if="!filtered.length">
          <td :colspan="15" class="empty-state">暂无设施检修记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filtered.length }} 条检修记录（沉降同步 {{ syncedCount }} 条，已关闭的不排队）</span>
      <span v-if="message" class="info-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  maintenanceRowsSorted,
  pendingMaintenanceCount,
  syncOverLimitToMaintenance,
} from '@/settlement/service'

const meta = moduleMeta('maintenance')
const actions = ['提交开工', '确认完工', '申请延期']
const statuses = ['待开工', '检修中', '已完工', '已延期', '已关闭']

const rows = ref<EntryRow[]>([])
const keyword = ref('')
const message = ref('')
const errorMessage = ref('')

const filtered = computed(() =>
  rows.value.filter((row) => {
    if (!keyword.value.trim()) return true
    const key = keyword.value.trim()
    return String(row['检修编号']).includes(key) || String(row['检修对象']).includes(key)
  }),
)

const stats = computed(() => {
  const synced = rows.value.filter((row) => row['关联断面'])
  const queued = synced.filter((row) => row.status !== '已关闭' && row.status !== '已完工')
  return [
    { label: '待办检修总数', value: pendingMaintenanceCount() },
    { label: '沉降超限待办', value: queued.length },
    { label: '高优先级', value: synced.filter((row) => row['检修优先级'] === '高' && row.status === '待开工').length },
    { label: '已关闭同步项', value: synced.filter((row) => row.status === '已关闭').length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => String(row.status) === status).length })),
)

const syncedCount = computed(() => rows.value.filter((row) => row['关联断面']).length)

function openCreate() {
  errorMessage.value = '检修记录登记入口尚未接入审批流'
}

function resync() {
  syncOverLimitToMaintenance()
  reload()
  message.value = '已按最新沉降观测值重新同步并排定检修待办顺序'
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  message.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function reload() {
  // 每次进页面先同步：保证检修清单读数与沉降页面口径一致
  syncOverLimitToMaintenance()
  rows.value = maintenanceRowsSorted()
}

onMounted(reload)
</script>

<style scoped>
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.row-synced {
  background: #fffaf2;
}
.priority {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.p-高 {
  background: #fde2d2;
  color: #b33a00;
}
.p-中 {
  background: #fff0c2;
  color: #9a6b00;
}
.p-低 {
  background: #eef1f4;
  color: #4a5568;
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.badge-warning {
  background: #fde2d2;
  color: #b33a00;
}
.badge-normal {
  background: #e3f4e4;
  color: #1f7a33;
}
.badge-closed {
  background: #eef1f4;
  color: #7a869a;
}
.info-text {
  color: #1f7a33;
}
</style>
