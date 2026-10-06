import type { Observation, SectionView, SettlementReport } from './settlement-types'

/** CSV 单元转义：含逗号/引号/换行时加引号包裹。 */
function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvLine(values: readonly (string | number)[]): string {
  return values.map(csvCell).join(',')
}

function fmt1(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 10) / 10)
}
function fmt2(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 100) / 100)
}

export const SUMMARY_FIELDS = [
  '监测断面',
  '最新监测编号',
  '累计沉降量(mm)',
  '沉降速率(mm/d)',
  '预警阈值(mm)',
  '最新监测日期',
  '观测次数',
  '断面状态',
  '归档核定',
  '验收/登记时间',
] as const

export const DETAIL_FIELDS = [
  '监测编号',
  '监测断面',
  '监测日期',
  '本次增量(mm)',
  '累计沉降量(mm)',
  '沉降速率(mm/d)',
  '预警阈值(mm)',
  '监测人员',
  '归档件',
  '数据来源',
  '待核定',
  '验收/登记时间',
  '备注',
] as const

/**
 * 沉降成果报表（单文件、按断面分组）：
 * 第一段为断面汇总（另存条数 = 页面断面行数），第二段为观测明细，
 * 末段为核对行——汇总断面数、明细条数、超限断面数、待查条数，
 * 报表与明细清单必须对得上，接收方可直接照此核对。
 * 纯函数：同一数据状态重复导出，文件内容逐字节一致，不残留上一轮差值。
 */
export function buildSettlementReport(
  sections: SectionView[],
  observations: Observation[],
  rejected: { code: string; section: string; date: string; reason: string }[],
): SettlementReport {
  const lines: string[] = []
  lines.push(csvLine(['结构沉降监测成果报表']))
  lines.push(csvLine(['口径', '累计沉降量沿增量链统一重算；沉降速率=本次增量÷相邻观测间隔，不叠加；同一断面只算一次；争议以归档件为准']))
  lines.push('')

  lines.push(csvLine(['【断面汇总】']))
  lines.push(csvLine(SUMMARY_FIELDS))
  for (const section of sections) {
    lines.push(
      csvLine([
        section.section,
        section.code,
        fmt1(section.cumulative),
        fmt2(section.rate),
        fmt1(section.threshold),
        section.latestDate,
        section.observationCount,
        section.status,
        section.archived ? '是' : '否',
        section.acceptedAt + (section.inferredAcceptedAt ? '（推定）' : ''),
      ]),
    )
  }
  lines.push('')

  lines.push(csvLine(['【观测明细】']))
  lines.push(csvLine(DETAIL_FIELDS))
  // 明细与汇总同序：断面按验收日期归位，断面内按观测日期排列。
  for (const section of sections) {
    for (const obs of section.observations) {
      lines.push(
        csvLine([
          obs.code,
          obs.section,
          obs.date,
          fmt1(obs.increment),
          fmt1(obs.cumulative),
          fmt2(obs.rate),
          fmt1(obs.threshold),
          obs.operator,
          obs.archived ? '归档件' : '',
          obs.origin,
          obs.needsReview ? obs.reviewReason : '',
          obs.acceptedAt + (obs.inferredAcceptedAt ? '（推定）' : ''),
          obs.note,
        ]),
      )
    }
  }
  lines.push('')

  if (rejected.length > 0) {
    lines.push(csvLine(['【重复提交退回】']))
    lines.push(csvLine(['监测编号', '监测断面', '观测日期', '退回原因']))
    for (const item of rejected) {
      lines.push(csvLine([item.code, item.section, item.date, item.reason]))
    }
    lines.push('')
  }

  const overLimit = sections.filter((s) => s.status === '超限预警').length
  const reviewCount = sections.reduce(
    (sum, s) => sum + (s.status === '超限预警' ? 1 : 0) + s.observations.filter((o) => o.needsReview).length,
    0,
  )
  const detailRows = sections.reduce((n, s) => n + s.observationCount, 0)
  lines.push(csvLine(['【核对】']))
  lines.push(csvLine(['汇总断面数', sections.length]))
  lines.push(csvLine(['明细观测条数', observations.length]))
  lines.push(csvLine(['超限预警断面数', overLimit]))
  lines.push(csvLine(['待查台账条数', reviewCount]))
  lines.push(csvLine(['重复退回笔数', rejected.length]))
  lines.push(csvLine(['核对结论', detailRows === observations.length ? '报表汇总与明细清单一致' : '报表与明细不一致']))

  return {
    filename: '结构沉降监测-断面成果报表.csv',
    content: `﻿${lines.join('\n')}`,
    sectionCount: sections.length,
    observationCount: observations.length,
    overLimitCount: overLimit,
    reviewCount,
  }
}

/** 单个断面分组下载：只含该断面的汇总行与明细，口径与总报表完全一致。 */
export function buildSectionReport(section: SectionView): SettlementReport {
  const single: SectionView = {
    ...section,
    observations: [...section.observations].sort((a, b) => (a.date < b.date ? -1 : 1)),
  }
  const report = buildSettlementReport([single], single.observations, [])
  const safeName = section.section.replace(/[\\/:*?"<>|\s]+/g, '_')
  return { ...report, filename: `结构沉降监测-${safeName}.csv` }
}
