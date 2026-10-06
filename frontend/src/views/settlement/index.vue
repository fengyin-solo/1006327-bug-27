<template>
  <section class="page" data-module="settlement">
    <header class="page-head">
      <div>
        <h2>结构沉降监测管理</h2>
        <p class="page-desc">按监测断面管理沉降成果：累计沉降量、沉降速率与导出报表共用同一份增量链口径，同一断面只算一次。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">登记观测</button>
        <button class="btn" type="button" @click="exportAll">导出断面成果报表</button>
        <button class="btn ghost" type="button" @click="resetAll">重置存量成果</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div v-if="reportCheck" class="recon-bar">
      <span>报表核对：汇总断面 {{ reportCheck.sectionCount }} 个 ＝ 页面条数；明细观测 {{ reportCheck.observationCount }} 条；超限断面 {{ reportCheck.overLimitCount }} 个；待查 {{ reportCheck.reviewCount }} 条；重复退回 {{ rejected.length }} 笔。</span>
      <span class="recon-ok">报表与明细清单一致</span>
    </div>

    <form v-if="showForm" class="filter-bar create-form" @submit.prevent="submitNew">
      <label class="filter-item">
        <span>监测断面 *</span>
        <input v-model="form.section" list="section-options" placeholder="如 K1+060 检查井" />
        <datalist id="section-options">
          <option v-for="s in sectionOptions" :key="s" :value="s" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>观测日期 *</span>
        <input v-model="form.date" type="date" />
      </label>
      <label class="filter-item">
        <span>本次增量(mm) *</span>
        <input v-model.number="form.increment" type="number" step="0.1" />
      </label>
      <label class="filter-item">
        <span>预警阈值(mm)</span>
        <input v-model.number="form.threshold" type="number" step="1" placeholder="缺省30" />
      </label>
      <label class="filter-item">
        <span>监测人员</span>
        <input v-model="form.operator" placeholder="缺省记待补" />
      </label>
      <button class="btn primary" type="submit">提交观测</button>
      <button class="btn ghost" type="button" @click="showForm = false">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>断面/编号/人员</span>
        <input v-model="filters.keyword" placeholder="按关键字检索" />
      </label>
      <label class="filter-item">
        <span>断面状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option value="沉降正常">沉降正常</option>
          <option value="超限预警">超限预警</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 28px"></th>
          <th>监测断面</th>
          <th>最新监测编号</th>
          <th>累计沉降量(mm)</th>
          <th>沉降速率(mm/d)</th>
          <th>预警阈值(mm)</th>
          <th>最新观测日期</th>
          <th>观测次数</th>
          <th>断面状态</th>
          <th>验收/登记时间</th>
          <th>断面分组下载</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="section in rows" :key="section.section">
          <tr :class="{ 'row-warn': section.status === '超限预警' }">
            <td><button class="link" type="button" @click="toggle(section.section)">{{ expanded[section.section] ? '收起' : '详情' }}</button></td>
            <td>{{ section.section }} <span v-if="section.archived" class="tag tag-arch">归档核定</span><span v-if="section.needsReview" class="tag tag-review">待查</span></td>
            <td>{{ section.code }}</td>
            <td><strong>{{ fmt1(section.cumulative) }}</strong></td>
            <td>{{ fmt2(section.rate) }}</td>
            <td>{{ fmt1(section.threshold) }}</td>
            <td>{{ section.latestDate }}</td>
            <td>{{ section.observationCount }}</td>
            <td>
              <span :class="['status-pill', section.status === '超限预警' ? 'pill-warn' : 'pill-ok']">{{ section.status }}</span>
            </td>
            <td>{{ section.acceptedAt }}<span v-if="section.inferredAcceptedAt" class="tag tag-infer">推定</span></td>
            <td><button class="link" type="button" @click="exportSection(section.section)">下载本断面</button></td>
          </tr>
          <tr v-if="expanded[section.section]">
            <td></td>
            <td colspan="10">
              <table class="detail-table">
                <thead>
                  <tr>
                    <th>监测编号</th><th>观测日期</th><th>本次增量(mm)</th><th>累计沉降量(mm)</th><th>沉降速率(mm/d)</th><th>监测人员</th><th>来源</th><th>核定</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="obs in section.observations" :key="obs.id" :class="{ 'row-warn': obs.needsReview }">
                    <td>{{ obs.code }}<span v-if="obs.archived" class="tag tag-arch">归档件</span></td>
                    <td>{{ obs.date }}</td>
                    <td>{{ fmt1(obs.increment) }}</td>
                    <td>{{ fmt1(obs.cumulative) }}</td>
                    <td>{{ fmt2(obs.rate) }}</td>
                    <td>{{ obs.operator }}</td>
                    <td>{{ obs.origin }}</td>
                    <td>{{ obs.needsReview ? obs.reviewReason : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td colspan="11" class="empty-state">没有符合条件的沉降断面</td>
        </tr>
      </tbody>
    </table>

    <section v-if="ledger.length" class="sub-panel">
      <h3>异常待查台账（运营概览 / 检修管理同源读取）</h3>
      <table class="data-table">
        <thead>
          <tr><th>监测断面</th><th>监测编号</th><th>读数日期</th><th>累计沉降量(mm)</th><th>沉降速率(mm/d)</th><th>异常结论</th><th>来源</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, idx) in ledger" :key="`${item.code}-${idx}`">
            <td>{{ item.section }}</td>
            <td>{{ item.code }}</td>
            <td>{{ item.date }}</td>
            <td>{{ fmt1(item.cumulative) }}</td>
            <td>{{ fmt2(item.rate) }}</td>
            <td>{{ item.conclusion }}</td>
            <td>{{ item.source }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="rejected.length" class="sub-panel">
      <h3>重复提交退回留痕（只认第一次落库）</h3>
      <table class="data-table">
        <thead>
          <tr><th>退回编号</th><th>监测断面</th><th>观测日期</th><th>提交增量(mm)</th><th>认可落库</th><th>退回原因</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in rejected" :key="item.id">
            <td>{{ item.code }}</td>
            <td>{{ item.section }}</td>
            <td>{{ item.date }}</td>
            <td>{{ fmt1(item.increment) }}</td>
            <td>{{ item.keptCode }}</td>
            <td>{{ item.reason }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="sub-panel">
      <h3>统一口径处理说明</h3>
      <ol class="notes-list">
        <li v-for="(note, idx) in notes" :key="idx">{{ note }}</li>
      </ol>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 个监测断面（另存条数照此口径），明细观测 {{ observations.length }} 条</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadReport,
  ensureSettlementReady,
  listRejected,
  listReviewLedger,
  listSettlement,
  resetSettlementData,
  sectionReport,
  settlementReport,
  SETTLEMENT_NOTES,
  submitObservation,
} from '@/api/settlement-service'
import type { Observation, ReviewItem, SectionView, SettlementReport } from '@/data/settlement-types'

const rows = ref<SectionView[]>([])
const observations = ref<Observation[]>([])
const ledger = ref<ReviewItem[]>([])
const rejected = ref(listRejected())
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const reportCheck = ref<SettlementReport | null>(null)
const message = ref('')
const messageOk = ref(true)
const showForm = ref(false)
const expanded = reactive<Record<string, boolean>>({})
const filters = reactive({ keyword: '', status: '' })
const form = reactive({ section: '', date: '', increment: null as number | null, threshold: null as number | null, operator: '' })
const notes = SETTLEMENT_NOTES

const sectionOptions = computed(() => rows.value.map((s) => s.section))

function fmt1(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 10) / 10)
}
function fmt2(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 100) / 100)
}

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function toggle(section: string) {
  expanded[section] = !expanded[section]
}

function resetFilters() {
  filters.keyword = ''
  filters.status = ''
  reload()
}

function reload() {
  const ready = ensureSettlementReady()
  observations.value = ready.observations
  ledger.value = ready.review
  rejected.value = listRejected()
  const payload = listSettlement({ keyword: filters.keyword, status: filters.status })
  rows.value = payload.sections
  total.value = payload.total
  stats.value = payload.stats
  reportCheck.value = settlementReport()
}

function submitNew() {
  if (!form.section.trim() || !form.date || form.increment == null) {
    notify('请填写监测断面、观测日期与本次增量', false)
    return
  }
  const result = submitObservation({
    section: form.section,
    date: form.date,
    increment: Number(form.increment),
    threshold: form.threshold,
    operator: form.operator || undefined,
  })
  notify(result.message, result.ok)
  if (result.ok) {
    form.section = ''
    form.date = ''
    form.increment = null
    form.threshold = null
    form.operator = ''
    showForm.value = false
  }
  reload()
}

function exportAll() {
  downloadReport(settlementReport())
  notify('已按断面分组导出，内容与页面口径一致，重复导出不残留旧值')
}

function exportSection(section: string) {
  const report = sectionReport(section)
  if (report) {
    downloadReport(report)
    notify(`已下载断面分组文件：${report.filename}`)
  }
}

function resetAll() {
  resetSettlementData()
  reload()
  notify('已恢复到存量成果迁移后的初始口径结果')
}

onMounted(reload)
</script>
