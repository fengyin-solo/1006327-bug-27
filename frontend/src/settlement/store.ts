import { LEGACY_RESULTS } from './legacy-seed'
import { buildMigratedState } from './migrate'
import type {
  ActionLog,
  LedgerEntry,
  Observation,
  ProcessingNote,
  Section,
  SettlementState,
  SubmissionRecord,
} from './types'

const STORAGE_KEY = 'urban-utility-tunnel:settlement-v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function initialState(): SettlementState {
  return buildMigratedState(clone(LEGACY_RESULTS))
}

function readState(): SettlementState {
  const fallback = initialState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as SettlementState
    if (!parsed || !Array.isArray(parsed.sections) || !parsed.migrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
      return fallback
    }
    return parsed
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: SettlementState | null = null

export function settlementState(): SettlementState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

export function persist(state: SettlementState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function updateState(mutator: (draft: SettlementState) => void): SettlementState {
  const draft = clone(settlementState())
  mutator(draft)
  persist(draft)
  return draft
}

/** 清空浏览器里的沉降数据并重新回填示例（演示/排错用） */
export function resetSettlementDemo(): SettlementState {
  const fresh = initialState()
  replayLegacyDuplicate(fresh)
  persist(fresh)
  syncOverLimitToMaintenance(fresh)
  return fresh
}

function nextSectionId(state: SettlementState): number {
  return state.sections.reduce((max, item) => Math.max(max, item.id), 0) + 1
}
function nextObsId(state: SettlementState): number {
  return state.observations.reduce((max, item) => Math.max(max, item.id), 0) + 1
}
function nextActionId(state: SettlementState): number {
  return state.actionLogs.reduce((max, item) => Math.max(max, item.id), 0) + 1
}
function nextSubmissionId(state: SettlementState): number {
  return state.submissions.reduce((max, item) => Math.max(max, item.id), 0) + 1
}
function nextLedgerId(state: SettlementState, type: string): string {
  const prefix = type.replace(/\s+/g, '')
  const count = state.ledger.filter((item) => item.type === type).length + 1
  return `ledger-${prefix}-${Date.now()}-${count}`
}

export type IntakeResult =
  | { ok: true; duplicate: false; observation: Observation; message: string }
  | { ok: false; duplicate: boolean; message: string }

export type IntakeInput = {
  sectionCode: string
  date: string
  elevation: number
  operator: string
  submittedAt?: string
}

/**
 * 受理一笔观测提交。
 * 同一笔重复提交（断面+监测日期+次别+高程 相同）只认第一次落库的那次，
 * 后面的整笔按重复退回：不写观测、只留受理记录与待查台账。
 */
export function acceptObservation(input: IntakeInput): IntakeResult {
  const state = settlementState()
  const submittedAt = input.submittedAt ?? new Date().toISOString()
  const section = state.sections.find((item) => item.code === input.sectionCode)
  if (!section) {
    return { ok: false, duplicate: false, message: `没有找到断面 ${input.sectionCode}` }
  }
  const sameDay = state.observations
    .filter((item) => item.sectionCode === input.sectionCode && item.date === input.date)
    .sort((a, b) => b.seq - a.seq)
  const seq = (sameDay[0]?.seq ?? 0) + 1

  // 同一笔 = 同断面 + 同监测日期 + 同高程；同日不同高程视为当日另一次观测（如下午复测）
  const duplicate = state.observations.find(
    (item) =>
      item.sectionCode === input.sectionCode &&
      item.date === input.date &&
      item.elevation === input.elevation,
  )
  const fingerprint = [input.sectionCode, input.date, duplicate?.seq ?? seq, input.elevation.toFixed(3)].join('|')

  if (duplicate) {
    updateState((draft) => {
      draft.submissions.push({
        id: nextSubmissionId(draft),
        fingerprint,
        sectionCode: input.sectionCode,
        date: input.date,
        seq: duplicate.seq,
        elevation: input.elevation,
        operator: input.operator,
        outcome: 'rejected_duplicate',
        message: '同一笔重复提交，只认第一次落库的那次，本笔整笔退回',
        submittedAt,
      })
      draft.ledger.push({
        id: nextLedgerId(draft, '重复提交'),
        sourceModule: '结构沉降监测',
        refCode: fingerprint,
        sectionCode: input.sectionCode,
        type: '重复提交',
        status: '已闭环',
        detail: `${input.date} ${input.elevation}m 与已落库观测为同一笔，重复提交整笔退回`,
        snapshotMm: null,
        foundAt: submittedAt,
        closedAt: submittedAt,
        resolution: '只认第一次落库的那次，本笔未写入观测数据',
      })
      draft.notes.push({
        id: `note-${input.sectionCode}-dup-${Date.now()}`,
        category: '重复退回',
        sectionCode: input.sectionCode,
        detail: `${input.date} 重复提交 ${input.elevation}m：与首次落库观测同指纹（${fingerprint}），整笔按重复退回，未参与任何计算。`,
        date: input.date,
      })
    })
    return {
      ok: false,
      duplicate: true,
      message: '同一笔重复提交，只认第一次落库的那次，本笔整笔按重复退回',
    }
  }

  const box: { value: Observation | null } = { value: null }
  updateState((draft) => {
    const observation: Observation = {
      id: nextObsId(draft),
      sectionCode: input.sectionCode,
      date: input.date,
      seq,
      elevation: input.elevation,
      operator: input.operator || '未登记',
      source: '正常登记',
      submittedAt,
    }
    draft.observations.push(observation)
    draft.submissions.push({
      id: nextSubmissionId(draft),
      fingerprint,
      sectionCode: input.sectionCode,
      date: input.date,
      seq,
      elevation: input.elevation,
      operator: input.operator,
      outcome: 'accepted',
      message: '第一次提交，已落库',
      submittedAt,
    })
    if (draft.sections.some((item) => item.code === input.sectionCode && item.status === '待监测')) {
      const target = draft.sections.find((item) => item.code === input.sectionCode)
      if (target) target.status = '监测中'
    }
    // 新观测直接导致超限时自动判超限并联动（人工已判定「沉降正常」的断面尊重人工结论，不自动顶回）
    const related = draft.observations.filter((item) => item.sectionCode === input.sectionCode)
    const sorted = [...related].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq,
    )
    const firstObs = sorted[0]
    const latestObs = sorted[sorted.length - 1]
    const archive = draft.archives.find((item) => item.sectionCode === input.sectionCode)
    const cumulative = archive
      ? archive.cumulativeMm
      : Math.round((firstObs.elevation - latestObs.elevation) * 1000 * 10) / 10
    const targetSection = draft.sections.find((item) => item.code === input.sectionCode)
    if (!targetSection) return
    const overLimit = cumulative > targetSection.thresholdMm
    if (overLimit && targetSection.status !== '沉降正常' && targetSection.status !== '超限预警') {
      targetSection.status = '超限预警'
      draft.actionLogs.push({
        id: nextActionId(draft),
        sectionCode: input.sectionCode,
        date: input.date,
        action: '标记预警',
        operator: '系统自动',
        note: `新观测后累计 ${cumulative}mm 超阈值 ${targetSection.thresholdMm}mm，自动预警`,
      })
      draft.ledger.push({
        id: nextLedgerId(draft, '超限预警'),
        sourceModule: '结构沉降监测',
        refCode: input.sectionCode,
        sectionCode: input.sectionCode,
        type: '超限预警',
        status: '待查',
        detail: `${input.sectionCode} 提交观测后累计沉降量 ${cumulative}mm 超阈值 ${targetSection.thresholdMm}mm，自动预警并同步检修待办`,
        snapshotMm: cumulative,
        foundAt: submittedAt,
      })
    }
    draft.actionLogs.push({
      id: nextActionId(draft),
      sectionCode: input.sectionCode,
      date: input.date,
      action: '提交监测',
      operator: input.operator || '未登记',
      note: `第 ${seq} 次观测，高程 ${input.elevation}m`,
    })
    box.value = observation
  })
  if (!box.value) {
    return { ok: false, duplicate: false, message: '观测落库失败' }
  }
  // 落库后按最新读数同步检修待办（幂等）
  const syncedRows = syncOverLimitToMaintenance()
  const queued = syncedRows.find(
    (row) => row['关联断面'] === input.sectionCode && row.status === '待开工',
  )
  const suffix = queued
    ? `；累计 ${queued['累计沉降量mm']}mm 超限，已同步检修待办 ${queued['检修编号']}（优先级 ${queued['检修优先级']}）`
    : ''
  return {
    ok: true,
    duplicate: false,
    observation: box.value,
    message: `已落库：${input.sectionCode} ${input.date} 第${box.value.seq}次观测 ${input.elevation}m${suffix}`,
  }
}

export type ActionOutcome = {
  ok: boolean
  message: string
  overLimit?: boolean
  cumulativeMm?: number
}

/** 人工状态流转（判定正常 / 标记预警）；动作、台账、检修待办在同一处联动 */
export function changeSectionStatus(code: string, action: string, operator = '当前值班'): ActionOutcome {
  const state = settlementState()
  const section = state.sections.find((item) => item.code === code)
  if (!section) {
    return { ok: false, message: `没有找到断面 ${code}` }
  }
  const target = action === '标记预警' ? '超限预警' : action === '判定正常' ? '沉降正常' : ''
  if (!target) {
    return { ok: false, message: `不支持的动作「${action}」` }
  }

  let outcome: ActionOutcome = { ok: true, message: `${code} 已${action}，状态「${target}」` }
  updateState((draft) => {
    const targetSection = draft.sections.find((item) => item.code === code)
    if (!targetSection) return
    targetSection.status = target
    draft.actionLogs.push({
      id: nextActionId(draft),
      sectionCode: code,
      date: new Date().toISOString().slice(0, 10),
      action,
      operator,
    })
    if (target === '超限预警') {
      const existing = draft.ledger.find(
        (item) => item.sectionCode === code && item.type === '超限预警' && item.status === '待查',
      )
      if (!existing) {
        draft.ledger.push({
          id: nextLedgerId(draft, '超限预警'),
          sourceModule: '结构沉降监测',
          refCode: code,
          sectionCode: code,
          type: '超限预警',
          status: '待查',
          detail: `${code} 累计沉降量超限，已同步设施检修管理清单按最新沉降值排队`,
          snapshotMm: null,
          foundAt: new Date().toISOString(),
        })
      }
    } else {
      draft.ledger
        .filter((item) => item.sectionCode === code && item.type === '超限预警' && item.status === '待查')
        .forEach((item) => {
          item.status = '已闭环'
          item.closedAt = new Date().toISOString()
          item.resolution = '断面判定沉降正常，超限预警闭环'
        })
    }
  })

  // 用最新口径读数回填台账快照，并联动检修待办
  const synced = syncOverLimitToMaintenance()
  const row = synced.find((item) => item['关联断面'] === code)
  if (target === '超限预警' && row) {
    updateState((draft) => {
      draft.ledger
        .filter((item) => item.sectionCode === code && item.type === '超限预警' && item.status === '待查')
        .forEach((item) => {
          item.snapshotMm = Number(row['累计沉降量mm'])
          item.detail = `${code} 累计沉降量 ${row['累计沉降量mm']}mm 超过阈值 ${row['预警阈值mm']}mm，已同步设施检修管理清单（检修编号 ${row['检修编号']}，优先级 ${row['检修优先级']}），按最新沉降值排队`
        })
    })
    outcome = {
      ok: true,
      message: `${code} 已标记超限预警并同步检修待办（${row['检修编号']}，${row['累计沉降量mm']}mm）`,
      overLimit: true,
      cumulativeMm: Number(row['累计沉降量mm']),
    }
  }
  return outcome
}

/** 闭环一条待查台账（其余入口核对后回填结论） */
export function closeLedgerEntry(id: string, resolution: string): boolean {
  const state = settlementState()
  if (!state.ledger.some((item) => item.id === id && item.status === '待查')) {
    return false
  }
  updateState((draft) => {
    const target = draft.ledger.find((item) => item.id === id)
    if (target) {
      target.status = '已闭环'
      target.closedAt = new Date().toISOString()
      target.resolution = resolution || '已核对闭环'
    }
  })
  return true
}

/** 登记一个新断面（登记监测点） */
export function registerSection(input: {
  code: string
  name: string
  thresholdMm: number
  acceptedDate: string
  operator: string
}): { ok: boolean; message: string } {
  const state = settlementState()
  if (state.sections.some((item) => item.code === input.code)) {
    return { ok: false, message: `断面 ${input.code} 已存在` }
  }
  updateState((draft) => {
    const now = new Date().toISOString()
    draft.sections.push({
      id: nextSectionId(draft),
      code: input.code,
      name: input.name,
      thresholdMm: input.thresholdMm,
      status: '待监测',
      acceptedDate: input.acceptedDate,
      registeredAt: now,
      registeredBasis: '验收日期',
    })
    draft.actionLogs.push({
      id: nextActionId(draft),
      sectionCode: input.code,
      date: input.acceptedDate,
      action: '验收归位',
      operator: input.operator,
      note: '新登记监测点，按验收日期归位',
    })
  })
  syncOverLimitToMaintenance()
  return { ok: true, message: `断面 ${input.code} 已登记，等待首次观测` }
}

/* ---------------- 设施检修管理联动 ---------------- */

import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { computeAllCanonical } from './canonical'

const MAINTENANCE_KEY = 'maintenance'
const MAINTENANCE_PREFIX = 'MAIN-SETT-'

/** 优先级按最新累计沉降量分档，供检修那边重排待办 */
export function priorityOf(cumulativeMm: number, thresholdMm: number): string {
  const ratio = cumulativeMm / thresholdMm
  if (ratio >= 1.3) return '高'
  if (ratio >= 1) return '中'
  return '低'
}

/**
 * 把超限断面同步成设施检修待办：
 * - 一个断面只对应一条检修记录（按 MAIN-SETT-<断面号> 幂等 upsert），不重复叠加；
 * - 累计沉降量/速率/优先级始终取统一口径的最新读数，待办按沉降值降序重排；
 * - 断面恢复正常后待办自动关闭（状态「已关闭」），不再排队。
 */
export function syncOverLimitToMaintenance(provided?: SettlementState): EntryRow[] {
  const state = provided ?? settlementState()
  const results = computeAllCanonical(state.sections, state.observations, state.archives)
  const rows = listRows(MAINTENANCE_KEY)
  const next = [...rows]

  results.forEach((result) => {
    const syncCode = `${MAINTENANCE_PREFIX}${result.section.code.replace(/^DMI-/, '')}`
    const index = next.findIndex((row) => row['检修编号'] === syncCode)
    // 是否需要检修排队跟随人工状态：标记预警才排队；判定沉降正常（已核实）则关闭/撤销待办。
    // canonical 的 overLimit 仅用于分档与页面提示，避免人工闭环后被读数自动顶回来。
    const shouldQueue = result.section.status === '超限预警'
    const priority = priorityOf(result.cumulativeMm, result.section.thresholdMm)
    const common = {
      检修编号: syncCode,
      检修对象: `${result.section.name}（${result.section.code}）`,
      检修类别: '沉降超限专项',
      检修班组: '结构监测班',
      计划工期: '接预警后3个工作日内',
      更换部件: '—',
      关联断面: result.section.code,
      来源: '沉降超限预警同步',
      累计沉降量mm: result.cumulativeMm,
      沉降速率: result.rateMmPerDay === null ? '—' : result.rateMmPerDay,
      预警阈值mm: result.section.thresholdMm,
      数值来源: result.valueSource,
      最近观测日期: result.latestDate,
      检修优先级: shouldQueue ? priority : '低',
      同步基准: "按最近观测读数同步",
    }

    if (shouldQueue) {
      if (index < 0) {
        const id = next.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
        next.push({
          id,
          status: '待开工',
          pending: true,
          abnormal: true,
          ...common,
          完工日期: '—',
          检修状态: '待开工',
        } as EntryRow)
      } else {
        const prev = next[index]
        next[index] = {
          ...prev,
          ...common,
          status: '待开工',
          pending: true,
          abnormal: true,
          完工日期: '—',
          检修状态: '待开工',
        } as EntryRow
      }
    } else if (index >= 0) {
      const prev = next[index]
      if (prev.status !== '已关闭' && prev.status !== '已完工') {
        next[index] = {
          ...prev,
          ...common,
          status: '已关闭',
          pending: false,
          abnormal: false,
          完工日期: new Date().toISOString().slice(0, 10),
          检修状态: '已关闭',
          同步基准: "按最近观测读数同步",
        } as EntryRow
      }
    }
  })

  saveRows(MAINTENANCE_KEY, next)
  return next.filter((row) => typeof row['关联断面'] === 'string')
}

/** 检修清单按「沉降同步待办优先、沉降值降序」重排后的完整列表 */
export function maintenanceRowsSorted(): EntryRow[] {
  const rows = listRows(MAINTENANCE_KEY)
  const synced = rows.filter((row) => typeof row['关联断面'] === 'string')
  const others = rows.filter((row) => typeof row['关联断面'] !== 'string')
  synced.sort((a, b) => {
    const order = { 待开工: 0, 检修中: 1, 已延期: 2, 已完工: 3, 已关闭: 4 } as Record<string, number>
    const sa = order[String(a.status)] ?? 9
    const sb = order[String(b.status)] ?? 9
    if (sa !== sb) return sa - sb
    return Number(b['累计沉降量mm']) - Number(a['累计沉降量mm'])
  })
  return [...synced, ...others]
}

/** 待办数（已关闭的同步条目不计待办） */
export function pendingMaintenanceCount(): number {
  return maintenanceRowsSorted().filter(
    (row) => row.pending && row.status !== '已关闭',
  ).length
}

/** 存量里的重复提交：迁移完成后按提交受理通道回放，保证只落第一次 */
function replayLegacyDuplicate(state: SettlementState): void {
  const dup = LEGACY_RESULTS.find((item) => item.重复提交)?.重复提交
  if (!dup) return
  const draft = clone(state)
  const acceptedId = nextObsId(draft)
  const submissionAcceptedId = nextSubmissionId(draft)
  const submissionDuplicateId = nextSubmissionId(draft)
  const fingerprint = [
    'DMI-04',
    dup.date,
    1,
    dup.elev.toFixed(3),
  ].join('|')
  draft.observations.push({
    id: acceptedId,
    sectionCode: 'DMI-04',
    date: dup.date,
    seq: 1,
    elevation: dup.elev,
    operator: dup.operator,
    source: '正常登记',
    note: '第一次提交，已落库',
    submittedAt: dup.acceptedAt,
  })
  draft.submissions.push(
    {
      id: submissionAcceptedId,
      fingerprint,
      sectionCode: 'DMI-04',
      date: dup.date,
      seq: 1,
      elevation: dup.elev,
      operator: dup.operator,
      outcome: 'accepted',
      message: '第一次提交，已落库',
      submittedAt: dup.acceptedAt,
    },
    {
      id: submissionDuplicateId,
      fingerprint,
      sectionCode: 'DMI-04',
      date: dup.date,
      seq: 1,
      elevation: dup.elev,
      operator: dup.operator,
      outcome: 'rejected_duplicate',
      message: '同一笔重复提交，只认第一次落库的那次，本笔整笔退回',
      submittedAt: dup.duplicateAt,
    },
  )
  draft.ledger.push({
    id: 'ledger-DMI-04-duplicate',
    sourceModule: '结构沉降监测',
    refCode: fingerprint,
    sectionCode: 'DMI-04',
    type: '重复提交',
    status: '已闭环',
    detail: `${dup.date} ${dup.elev}m 被提交两次（${dup.acceptedAt} / ${dup.duplicateAt}），只认第一次落库，第二笔整笔退回`,
    snapshotMm: null,
    foundAt: dup.duplicateAt,
    closedAt: dup.duplicateAt,
    resolution: '第一笔已落库，重复笔未写入观测数据',
  })
  draft.notes.push({
    id: 'note-DMI-04-duplicate',
    category: '重复退回',
    sectionCode: 'DMI-04',
    detail: `${dup.date} ${dup.elev}m 同一笔提交两次：只认 ${dup.acceptedAt} 第一次落库的那次，${dup.duplicateAt} 的重复笔整笔退回，未参与累计沉降量与速率计算。`,
    date: dup.date,
  })
  Object.assign(state, draft)
}

/* ---------------- 初始化 ---------------- */

let initialized = false

/** 模块首次使用时确保：存量已回填、重复提交已裁决、检修待办已按最新值同步 */
export function ensureSettlementReady(): SettlementState {
  const state = settlementState()
  if (!initialized) {
    if (!state.submissions.some((item) => item.outcome === 'rejected_duplicate')) {
      replayLegacyDuplicate(state)
      persist(state)
    }
    syncOverLimitToMaintenance(state)
    initialized = true
  }
  return state
}

export type {
  ActionLog,
  LedgerEntry,
  Observation,
  ProcessingNote,
  Section,
  SubmissionRecord,
}
