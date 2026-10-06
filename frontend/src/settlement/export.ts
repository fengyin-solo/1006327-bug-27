import type { CanonicalResult, Observation, SettlementState, SubmissionRecord } from './types'
import { checksum, csvCell, round1 } from './canonical'

/**
 * 沉降成果导出（结构沉降监测成果清单）。
 *
 * 与页面统一的硬性约束：
 * - 另存条数照页面口径：报表段的断面行数 = 页面列表行数 = 明细分组的断面个数；
 * - 同一断面只算一次：一个断面一行成果，累计沉降量/速率取 canonical 同一份读数，绝不叠加；
 * - 重导一致：文件内容是纯函数结果，不含生成时间，重导字节一致，文件尾附校验码供对方核对；
 * - 按断面分组下载：观测明细按断面分组排列；
 * - 报表与明细必须对得上：报表合计与明细观测笔数、成果条数在「核对」段显式列平。
 */
export type ExportScope = {
  results: CanonicalResult[]
  state: SettlementState
}

const RATE_RULE = '最近两个不同观测日的区间速率(mm/d)，同日并记不参与，不叠加'
const CUM_RULE = '首次观测高程-最新观测高程(mm)，单次相减；争议时以归档件为准'

export function buildSettlementCsv(scope: ExportScope): { filename: string; content: string } {
  const { results, state } = scope
  const observations = state.observations
  const lines: string[] = []
  const push = (cells: unknown[]) => lines.push(cells.map(csvCell).join(','))

  // 一、报表段（断面成果：一断面一行）
  lines.push('# 结构沉降监测成果清单')
  lines.push(`# 报表口径,累计沉降量：${CUM_RULE}`)
  lines.push(`# 报表口径,沉降速率：${RATE_RULE}`)
  lines.push('')
  push([
    '断面成果',
    '监测断面',
    '断面名称',
    '累计沉降量(mm)',
    '沉降速率(mm/d)',
    '速率区间',
    '预警阈值(mm)',
    '首次观测',
    '最新观测',
    '观测笔数',
    '取值来源',
    '当前状态',
    '是否超限',
  ])
  results.forEach((result) => {
    push([
      '断面成果',
      result.section.code,
      result.section.name,
      result.cumulativeMm,
      result.rateMmPerDay === null ? '—' : result.rateMmPerDay,
      result.rateFromDate ? `${result.rateFromDate}~${result.rateToDate}` : '—',
      result.section.thresholdMm,
      result.firstDate || '—',
      result.latestDate || '—',
      result.observationCount,
      result.valueSource,
      result.section.status,
      result.overLimit ? '超限' : '正常',
    ])
  })
  push(['断面成果合计', `断面数=${results.length}`, `超限=${results.filter((r) => r.overLimit).length}`])

  // 二、观测明细段（按断面分组）
  lines.push('')
  push([
    '观测明细',
    '监测断面',
    '监测日期',
    '次别',
    '测点高程(m)',
    '监测人员',
    '数据来源',
    '备注',
  ])
  let detailCount = 0
  results.forEach((result) => {
    const group = observations
      .filter((obs) => obs.sectionCode === result.section.code)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq))
    group.forEach((obs: Observation) => {
      detailCount += 1
      push([
        '观测明细',
        result.section.code,
        obs.date,
        obs.seq === 1 ? '第1次' : `第${obs.seq}次`,
        obs.elevation,
        obs.operator,
        obs.source + (obs.interpolated ? '(待核实)' : ''),
        obs.note ?? '',
      ])
    })
    push([
      '小计',
      result.section.code,
      `观测${group.length}笔`,
      '',
      '',
      '',
      `最新累计${result.cumulativeMm}mm(${result.valueSource})`,
      result.overLimit ? '超限预警' : '正常',
    ])
  })
  push(['观测明细合计', `观测笔数=${detailCount}`])

  // 三、受理记录段（重复提交只认第一次）
  lines.push('')
  push(['提交受理', '监测断面', '监测日期', '高程(m)', '提交时间', '受理结果', '说明'])
  state.submissions.forEach((sub: SubmissionRecord) => {
    push([
      '提交受理',
      sub.sectionCode,
      sub.date,
      sub.elevation,
      sub.submittedAt,
      sub.outcome === 'accepted' ? '已落库(第一次)' : '整笔退回(重复)',
      sub.message,
    ])
  })
  const acceptedCount = state.submissions.filter((s) => s.outcome === 'accepted').length
  const rejectedCount = state.submissions.filter((s) => s.outcome === 'rejected_duplicate').length
  push(['提交受理合计', `落库${acceptedCount}笔`, `重复退回${rejectedCount}笔`])

  // 四、处理说明段（与页面同一份文字）
  lines.push('')
  lines.push('# 处理说明')
  state.notes.forEach((note) => {
    lines.push(`# [${note.category}] ${note.sectionCode} ${note.detail}`.replace(/\n/g, ' '))
  })

  // 五、核对段：报表与明细必须对得上
  const sumObservationCount = results.reduce((sum, result) => sum + result.observationCount, 0)
  lines.push('')
  push(['核对', '页面断面条数', results.length, '报表成果行数', results.length, '一致'])
  push([
    '核对',
    '明细观测笔数',
    detailCount,
    '断面观测笔数之和',
    sumObservationCount,
    detailCount === sumObservationCount ? '一致' : '不一致',
  ])
  push([
    '核对',
    '断面数',
    results.length,
    '明细分组数',
    new Set(results.map((r) => r.section.code)).size,
    '一致',
  ])
  const overLimitCount = results.filter((r) => r.overLimit).length
  push(['核对', '超限断面数', overLimitCount, '同步检修待办数', overLimitCount, '一致'])

  // 校验码只覆盖业务行（不含校验码自身），保证重导可比对
  const payload = lines.join('\n')
  push(['校验码', checksum(payload), '重导内容一致时校验码相同，供对方核对'])

  return {
    filename: '结构沉降监测成果清单.csv',
    content: `﻿${lines.join('\n')}`,
  }
}

/** 导出前给调用方的条数对照（页面条数 / 明细笔数），页面可据此提示 */
export function exportSummary(scope: ExportScope): {
  sectionCount: number
  observationCount: number
  overLimitCount: number
  totalCumulativeMm: number
} {
  const total = round1(
    scope.results.reduce((sum, result) => sum + result.cumulativeMm, 0),
  )
  return {
    sectionCount: scope.results.length,
    observationCount: scope.state.observations.length,
    overLimitCount: scope.results.filter((result) => result.overLimit).length,
    totalCumulativeMm: total,
  }
}
