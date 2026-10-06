import { listRows, saveRows } from '@/data/local-store'
import { buildReviewLedger, buildSections, DEFAULT_THRESHOLD, MISSING_OPERATOR } from '@/data/settlement-engine'
import { buildSectionReport, buildSettlementReport } from '@/data/settlement-report'
import {
  getObservations,
  getRejected,
  resetSettlement,
  saveObservations,
  saveRejected,
} from '@/data/settlement-store'
import type {
  EntryRow,
} from '@/data/types'
import type { Observation, RejectedSubmission, ReviewItem, SectionView, SettlementReport } from '@/data/settlement-types'

/** 沉降成果统一口径处理说明（页面、导出文件同源展示，对方照此核对）。 */
export const SETTLEMENT_NOTES: string[] = [
  '累计沉降量与沉降速率取同一份口径：按监测断面分组，沿「本次增量」增量链统一重算，列表、详情面板、导出文件共用断面聚合结果。',
  '同一断面只算一次：断面汇总取该断面最新一次观测的链上累计与速率，不跨行、不跨断面叠加；另存条数照页面断面口径，报表汇总断面数与页面条数一致。',
  '沉降速率只按相邻两次观测计算：本次增量 ÷ 两次观测间隔天数，首测为 0，不做两次观测叠加。',
  '存量成果按监测日期回填；早年把两次观测写成一条的合并记录，按当年台账留下的两个观测日期拆为两条，合并增量均分（尾差并入后一次），标「合并拆分」并进待查台账待补测核定。',
  '历史取值有争议时以归档件为准：取断面最晚一份归档件读数为锚点，其余读数按增量链从锚点向前回推、向后顺推，旧登记累计不直接采用。',
  '既有条目按验收日期归位排序；早年没有登记时间的，按该断面最早一次动作（最早观测日期）推定，界面标注「推定」。',
  '缺项补齐方式：预警阈值缺省统一按 30mm 补入（同断面已登记阈值的随该断面补齐）；监测人员缺登记记「未登记（待补）」并推定同断面观测人；本次增量缺登记按 0 补入；以上均挂待查台账，补测核定后以核定额替换，不臆造观测值。',
  '同一笔重复提交（同断面、同观测日期、同增量）只认第一次落库，后面的整笔按重复退回，退回笔数在页面与报表中留痕，不进入累计计算。',
  '超限断面（最新累计沉降量大于预警阈值）自动判定预警，并同步一条「沉降预警联动」检修待办到设施检修管理；沉降值更新后待办按最新累计沉降量降序重排；预警解除的，联动检修单标记已完工。',
  '异常结论回写待查台账，运营概览、结构沉降监测、设施检修管理三处读同一份断面口径，读数一致。',
  '导出为纯函数产物，同一数据状态重复导出内容逐字节一致，不残留上一轮差值；文件按断面分组，末段含汇总断面数、明细条数、超限断面数与待查条数等核对行，报表与明细清单必须对得上。',
]

function canonicalAll(): { observations: Observation[]; rejected: RejectedSubmission[]; sections: SectionView[] } {
  const observations = getObservations()
  const rejected = getRejected()
  const sections = buildSections(observations)
  return { observations, rejected, sections }
}

/** 通用 settlement 表的镜像：一条断面一行，概览统计与沉降页面口径一致。 */
function mirrorGenericRows(sections: SectionView[]): void {
  const rows: EntryRow[] = sections.map((section, index) => ({
    id: index + 1,
    status: section.status,
    pending: section.status === '超限预警' || section.needsReview,
    abnormal: section.status === '超限预警' || section.needsReview,
    监测编号: section.code,
    监测断面: section.section,
    累计沉降量: `${round1(section.cumulative)}`,
    沉降速率: `${round2(section.rate)}`,
    预警阈值: `${round1(section.threshold)}`,
    监测日期: section.latestDate,
    监测人员: section.operator,
    监测状态: section.status,
  }))
  saveRows('settlement', rows)
}

/**
 * 超限预警 → 设施检修管理清单联动。
 * 幂等：同一断面只维护一条联动检修单，ID 按断面稳定分配，反复提交/重算不产生重复待办、不漂移行身份；
 * 待办顺序按最新累计沉降量降序；预警解除的联动单自动收口，再次超限且非人工完工的自动重开。
 */
function syncMaintenanceTodos(sections: SectionView[]): void {
  const rows = listRows('maintenance')
  const next = [...rows]
  const syncedIndex = new Map<string, number>()
  next.forEach((row, index) => {
    if (row.来源 === '沉降预警联动') {
      syncedIndex.set(String(row.监测断面), index)
    }
  })

  // 已存在断面沿用其既有 ID；新断面用「最大联动 ID + 1」，保证稳定不漂移。
  let nextSyncedId = 5000
  next.forEach((row) => {
    if (row.来源 === '沉降预警联动' && Number(row.id) >= nextSyncedId) {
      nextSyncedId = Number(row.id) + 1
    }
  })
  const idBySection = new Map<string, number>()
  for (const section of sections.filter((s) => s.status === '超限预警')) {
    const existingIndex = syncedIndex.get(section.section)
    idBySection.set(
      section.section,
      existingIndex == null ? nextSyncedId++ : Number(next[existingIndex].id),
    )
  }

  let seq = 1
  sections
    .filter((s) => s.status === '超限预警')
    .sort((a, b) => b.cumulative - a.cumulative || a.section.localeCompare(b.section))
    .forEach((section) => {
      const stableId = idBySection.get(section.section) ?? 5000 + seq
      const payload: EntryRow = {
        id: stableId,
        status: '待开工',
        pending: true,
        abnormal: true,
        检修编号: `MAIN-WARN-${String(stableId - 4999).padStart(2, '0')}`,
        检修对象: `沉降断面 ${section.section}`,
        检修类别: '沉降超限处置',
        检修班组: '结构监测班组',
        计划工期: section.latestDate,
        完工日期: '',
        更换部件: `累计沉降${round1(section.cumulative)}mm/阈值${round1(section.threshold)}mm`,
        检修状态: '待开工',
        来源: '沉降预警联动',
        监测断面: section.section,
        沉降值: round1(section.cumulative),
        沉降速率: round2(section.rate),
        预警阈值: round1(section.threshold),
      }
      const existingIndex = syncedIndex.get(section.section)
      if (existingIndex == null) {
        next.push(payload)
      } else {
        const existing = next[existingIndex]
        // 人工已经开工/延期/完工确认的单子保留人工状态；仅被系统自动收口（预警解除）的单子重新打开。
        const manualClosed = existing.status === '已完工' && existing.完工日期 !== '预警解除自动收口'
        const reopen = existing.status === '已完工' && !manualClosed
        const keepStatus = existing.status === '检修中' || existing.status === '已延期' || manualClosed
        next[existingIndex] = {
          ...payload,
          id: existing.id,
          检修编号: String(existing.检修编号 ?? payload.检修编号),
          status: keepStatus ? existing.status : '待开工',
          pending: keepStatus ? Boolean(existing.pending) : true,
          abnormal: true,
          检修状态: keepStatus ? String(existing.status) : '待开工',
          完工日期: reopen ? '' : (existing.完工日期 ?? ''),
        }
      }
      seq += 1
    })

  // 曾经预警、现已回落的断面：联动单收口为已完工，不再占用待办。
  const overLimitSections = new Set(sections.filter((s) => s.status === '超限预警').map((s) => s.section))
  next.forEach((row, index) => {
    if (row.来源 === '沉降预警联动' && !overLimitSections.has(String(row.监测断面))) {
      next[index] = { ...row, status: '已完工', pending: false, 检修状态: '已完工', 完工日期: '预警解除自动收口' }
    }
  })

  saveRows('maintenance', next)
}

/** 应用启动与每次写库后调用：统一口径 → 镜像 → 检修联动，保证各入口读数一致。 */
export function ensureSettlementReady(): {
  observations: Observation[]
  sections: SectionView[]
  rejected: RejectedSubmission[]
  review: ReviewItem[]
} {
  const { observations, rejected, sections } = canonicalAll()
  const review = buildReviewLedger(sections)
  mirrorGenericRows(sections)
  syncMaintenanceTodos(sections)
  return { observations, sections, rejected, review }
}

export interface SettlementListResult {
  sections: SectionView[]
  total: number
  stats: { label: string; value: number }[]
}

/** 沉降页面列表：断面口径，支持断面/编号关键字与状态筛选。 */
export function listSettlement(filters: { keyword?: string; status?: string } = {}): SettlementListResult {
  const { sections } = canonicalAll()
  const keyword = (filters.keyword ?? '').trim()
  const status = (filters.status ?? '').trim()
  const matched = sections.filter((section) => {
    const hitKeyword =
      keyword === '' || section.section.includes(keyword) || section.code.includes(keyword) || section.operator.includes(keyword)
    const hitStatus = status === '' || section.status === status
    return hitKeyword && hitStatus
  })
  const stats = [
    { label: '监测断面', value: sections.length },
    { label: '沉降正常断面', value: sections.filter((s) => s.status === '沉降正常').length },
    { label: '超限预警断面', value: sections.filter((s) => s.status === '超限预警').length },
    { label: '待查条目', value: buildReviewLedger(sections).length },
  ]
  return { sections: matched, total: matched.length, stats }
}

export interface SubmitInput {
  section: string
  date: string
  increment: number
  threshold?: number | null
  operator?: string
  code?: string
}

export type SubmitResult =
  | { ok: true; message: string; duplicate: false }
  | { ok: false; message: string; duplicate: true }

/**
 * 登记一次观测（幂等）：同一断面 + 同一观测日期 + 同一增量视为同一笔，
 * 只认第一次落库，后续整笔按重复退回。
 */
export function submitObservation(input: SubmitInput, now = new Date()): SubmitResult {
  const observations = getObservations()
  const rejected = getRejected()
  const increment = round1(Number(input.increment) || 0)
  const section = input.section.trim()
  const duplicate = observations.some(
    (o) => o.section === section && o.date === input.date && o.increment === increment,
  )
  if (duplicate) {
    const kept = observations.find((o) => o.section === section && o.date === input.date && o.increment === increment)!
    const entry: RejectedSubmission = {
      id: (rejected.at(-1)?.id ?? 9000) + 1,
      code: input.code?.trim() || nextCode(observations),
      section,
      date: input.date,
      increment,
      submittedAt: now.toISOString().slice(0, 10),
      reason: '同一笔观测重复提交，仅认第一次落库，整笔按重复退回',
      keptCode: kept.code,
    }
    saveRejected([...rejected, entry])
    ensureSettlementReady()
    return { ok: false, duplicate: true, message: `该笔观测与已落库的 ${kept.code} 完全重复，整笔按重复退回` }
  }

  const sameSection = observations.filter((o) => o.section === section)
  const threshold =
    input.threshold == null || Number.isNaN(Number(input.threshold))
      ? sameSection.at(-1)?.threshold ?? DEFAULT_THRESHOLD
      : round1(Number(input.threshold))
  const operator = input.operator?.trim() || sameSection.at(-1)?.operator || MISSING_OPERATOR
  const observation: Observation = {
    id: (observations.at(-1)?.id ?? 0) + 1,
    code: input.code?.trim() || nextCode(observations),
    section,
    date: input.date,
    increment,
    cumulative: 0,
    rate: 0,
    threshold,
    operator,
    archived: false,
    origin: '正常登记',
    needsReview: operator === MISSING_OPERATOR,
    reviewReason: operator === MISSING_OPERATOR ? '监测人员缺登记，需补登' : '',
    note: '',
    submitSeq: 1,
    acceptedAt: now.toISOString().slice(0, 10),
    inferredAcceptedAt: false,
  }
  saveObservations([...observations, observation])
  ensureSettlementReady()
  return { ok: true, duplicate: false, message: `已登记 ${observation.code}，累计沉降量与速率按统一口径重算` }
}

function nextCode(observations: Observation[]): string {
  let max = 0
  for (const obs of observations) {
    const match = /^SETT-(\d+)/.exec(obs.code)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `SETT-${String(max + 1).padStart(4, '0')}`
}

export function listReviewLedger(): ReviewItem[] {
  return buildReviewLedger(buildSections(getObservations()))
}

export function listRejected(): RejectedSubmission[] {
  return getRejected()
}

export function settlementReport(): SettlementReport {
  const { observations, rejected, sections } = canonicalAll()
  return buildSettlementReport(sections, observations, rejected)
}

export function sectionReport(sectionName: string): SettlementReport | null {
  const section = canonicalAll().sections.find((s) => s.section === sectionName)
  return section ? buildSectionReport(section) : null
}

export function resetSettlementData(): void {
  resetSettlement()
  ensureSettlementReady()
}

/** 设施检修管理读取：沉降预警联动待办（未收口）按最新累计沉降量降序置顶，其余记录在后。 */
export function listMaintenanceRows(): EntryRow[] {
  ensureSettlementReady()
  return [...listRows('maintenance')].sort((a, b) => {
    const pendingA = a.来源 === '沉降预警联动' && a.status !== '已完工'
    const pendingB = b.来源 === '沉降预警联动' && b.status !== '已完工'
    if (pendingA !== pendingB) {
      return pendingA ? -1 : 1
    }
    if (pendingA && pendingB) {
      return Number(b.沉降值 ?? 0) - Number(a.沉降值 ?? 0)
    }
    return Number(a.id) - Number(b.id)
  })
}

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** 触发浏览器下载。内容由纯函数报表生成，重复导出逐字节一致。 */
export function downloadReport(report: SettlementReport): void {
  const blob = new Blob([report.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = report.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
