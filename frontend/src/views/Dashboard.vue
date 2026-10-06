<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。沉降异常结论与沉降监测、设施检修读同一份口径。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="reviewItems.length" class="sub-panel">
      <h3>异常待查台账（沉降监测 / 设施检修管理同源）</h3>
      <table class="data-table">
        <thead>
          <tr><th>监测断面</th><th>监测编号</th><th>读数日期</th><th>累计沉降量(mm)</th><th>沉降速率(mm/d)</th><th>异常结论</th><th>来源</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, idx) in reviewItems" :key="`${item.code}-${idx}`">
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
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { ensureSettlementReady, listReviewLedger } from '@/api/settlement-service'
import type { OverviewResult } from '@/data/types'
import type { ReviewItem } from '@/data/settlement-types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const reviewItems = ref<ReviewItem[]>([])

function formatNumber(value: number, digits: 1 | 2): string {
  const factor = digits === 1 ? 10 : 100
  return String(Math.round((value + Number.EPSILON) * factor) / factor)
}

function refresh() {
  // 先让沉降统一口径完成镜像与检修联动，概览统计、台账再读取，保证各入口读数一致。
  ensureSettlementReady()
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  reviewItems.value = listReviewLedger()
}

onMounted(refresh)
</script>
