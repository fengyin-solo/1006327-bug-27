<template>
  <section class="page" data-module="ledger">
    <header class="page-head">
      <div>
        <h2>沉降待查台账</h2>
        <p class="page-desc">
          汇总各入口回写的沉降异常结论：超限预警、重复提交退回、并记拆分、缺项补项、取值争议。
          快照读数与结构沉降监测页面取自同一份口径，两边读数一致。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="reload">刷新读数</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="() => {}">
      <label class="filter-item">
        <span>来源入口</span>
        <select v-model="sourceFilter">
          <option value="">全部</option>
          <option v-for="source in sources" :key="source" :value="source">{{ source }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>异常类型</span>
        <select v-model="typeFilter">
          <option value="">全部</option>
          <option v-for="type in types" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option value="待查">待查</option>
          <option value="已闭环">已闭环</option>
        </select>
      </label>
      <button class="btn ghost" type="button" @click="clearFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>发现时间</th>
          <th>来源入口</th>
          <th>关联断面</th>
          <th>异常类型</th>
          <th>异常说明</th>
          <th>发生时读数(mm)</th>
          <th>当前读数(mm)</th>
          <th>状态</th>
          <th>闭环结论</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in filtered" :key="entry.id" :class="{ 'row-open': entry.status === '待查' }">
          <td>{{ formatTime(entry.foundAt) }}</td>
          <td>{{ entry.sourceModule }}</td>
          <td>
            <RouterLink v-if="entry.sectionCode" :to="`/settlement`" class="link">
              {{ entry.sectionCode }}
            </RouterLink>
            <span v-else>—</span>
          </td>
          <td><span class="type-tag">{{ entry.type }}</span></td>
          <td class="detail-cell">{{ entry.detail }}</td>
          <td class="num">{{ entry.snapshotMm === null ? '—' : entry.snapshotMm }}</td>
          <td class="num">
            <template v-if="entry.sectionCode && currentOf(entry.sectionCode) !== null">
              {{ currentOf(entry.sectionCode) }}
              <span v-if="entry.snapshotMm !== null && Number(currentOf(entry.sectionCode)) !== entry.snapshotMm"
                class="drift" title="发生后断面又有新观测，已按统一口径更新">↻</span>
            </template>
            <span v-else>—</span>
          </td>
          <td>
            <span class="status-badge" :class="entry.status === '待查' ? 'badge-open' : 'badge-done'">
              {{ entry.status }}
            </span>
          </td>
          <td class="detail-cell">{{ entry.resolution ?? '—' }}</td>
          <td class="row-actions">
            <button v-if="entry.status === '待查'" class="link" type="button" @click="closingId = entry.id">
              核对闭环
            </button>
            <span v-else>{{ formatTime(entry.closedAt ?? '') }}</span>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="10" class="empty-state">暂无符合条件的待查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filtered.length }} 条台账记录；「当前读数」实时取自沉降页面统一口径，↻ 表示闭环前断面已有更新观测。</span>
      <span v-if="message" class="info-text">{{ message }}</span>
    </footer>

    <div v-if="closingId" class="modal-mask" @click.self="closingId = ''">
      <div class="modal">
        <header class="modal-head">
          <h3>核对并闭环待查项</h3>
          <button class="link" type="button" @click="closingId = ''">关闭</button>
        </header>
        <div class="modal-body">
          <p class="form-hint">闭环结论会留痕；读数以结构沉降监测页面的统一口径为准。</p>
          <label class="form-row">
            <span>核对结论</span>
            <textarea v-model="closingResolution" rows="3" placeholder="如：已核对原始记录本，拆分高程无误"></textarea>
          </label>
          <div class="modal-actions">
            <button class="btn primary" type="button" @click="confirmClose">确认闭环</button>
            <button class="btn ghost" type="button" @click="closingId = ''">取消</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { closeLedgerEntry, settlementView } from '@/settlement/service'
import type { CanonicalResult, LedgerEntry } from '@/settlement/types'

const ledger = ref<LedgerEntry[]>([])
const currentResults = ref<CanonicalResult[]>([])
const sourceFilter = ref('')
const typeFilter = ref('')
const statusFilter = ref('')
const closingId = ref('')
const closingResolution = ref('')
const message = ref('')

const sources = computed(() => Array.from(new Set(ledger.value.map((item) => item.sourceModule))))
const types = computed(() => Array.from(new Set(ledger.value.map((item) => item.type))))

const filtered = computed(() =>
  ledger.value.filter((item) =>
    (!sourceFilter.value || item.sourceModule === sourceFilter.value) &&
    (!typeFilter.value || item.type === typeFilter.value) &&
    (!statusFilter.value || item.status === statusFilter.value),
  ),
)

const stats = computed(() => [
  { label: '台账总数', value: ledger.value.length },
  { label: '待查', value: ledger.value.filter((item) => item.status === '待查').length },
  { label: '已闭环', value: ledger.value.filter((item) => item.status === '已闭环').length },
  {
    label: '关联超限断面',
    value: new Set(
      ledger.value
        .filter((item) => item.type === '超限预警' && item.status === '待查')
        .map((item) => item.sectionCode),
    ).size,
  },
])

function currentOf(code: string): number | null {
  return currentResults.value.find((item) => item.section.code === code)?.cumulativeMm ?? null
}

function formatTime(stamp: string): string {
  if (!stamp) return '—'
  return stamp.length > 10 ? stamp.replace('T', ' ').slice(0, 16) : stamp
}

function clearFilters() {
  sourceFilter.value = ''
  typeFilter.value = ''
  statusFilter.value = ''
}

function confirmClose() {
  if (!closingId.value) return
  closeLedgerEntry(closingId.value, closingResolution.value.trim() || '已核对闭环')
  message.value = '待查项已闭环，结论已留痕'
  closingId.value = ''
  closingResolution.value = ''
  reload()
}

function reload() {
  const view = settlementView()
  ledger.value = view.ledger
  currentResults.value = view.results
}

onMounted(reload)
</script>

<style scoped>
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.row-open {
  background: #fffaf2;
}
.detail-cell {
  max-width: 320px;
  line-height: 1.5;
}
.type-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  background: #e7edff;
  color: #2a47b0;
  font-size: 12px;
  white-space: nowrap;
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.badge-open {
  background: #fde2d2;
  color: #b33a00;
}
.badge-done {
  background: #e3f4e4;
  color: #1f7a33;
}
.drift {
  margin-left: 4px;
  color: #9a6b00;
  cursor: help;
}
.info-text {
  color: #1f7a33;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh 16px;
  z-index: 50;
}
.modal {
  width: 520px;
  max-width: 100%;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.25);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid #e6ebf2;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.modal-body {
  padding: 16px 18px;
}
.form-hint {
  margin: 0 0 12px;
  color: #7a869a;
  font-size: 13px;
}
.form-row {
  display: flex;
  gap: 10px;
}
.form-row > span {
  width: 72px;
  padding-top: 6px;
  color: #4a5568;
}
.form-row textarea {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #cfd8e3;
  border-radius: 6px;
  resize: vertical;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>
