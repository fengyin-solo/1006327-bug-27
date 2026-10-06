import type { LegacyObs } from './settlement-legacy'
import type { Observation, ObsOrigin, RejectedSubmission, ReviewItem, SectionView } from './settlement-types'

/** 预警阈值缺项时统一按 30mm 补入（处理说明第 7 条）。 */
export const DEFAULT_THRESHOLD = 30
export const MISSING_OPERATOR = '未登记（待补）'

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** UTC 日期差，避免本地时区/夏令时把间隔算偏。 */
function daySpan(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** 早年缺登记时间：按该断面最早一次动作（最早观测日期）推定。 */
function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) - days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** 归一化中间形态：比正式观测多一个归档锚点，重算时使用。 */
interface RawObs {
  code: string
  section: string
  date: string
  increment: number
  threshold: number
  operator: string
  archived: boolean
  /** 归档件累计读数（争议锚点）；非归档条为 null。 */
  anchor: number | null
  acceptedAt: string
  inferredAcceptedAt: boolean
  origin: ObsOrigin
  needsReview: boolean
  reviewReason: string
  note: string
  legacyId: number
}

/**
 * 存量归一化：
 * 1. 合并条拆成两次独立观测，合并增量在两个日期上均分，标记待核定；
 * 2. 同一断面同一日期同一增量的重复提交，只认第一条（老系统 id 最小），其余整笔退回；
 * 3. 缺项补齐：阈值 30、人员「未登记（待补）」、缺增量按 0 补并待补测；
 * 4. 验收日期取 acceptedAt，缺登记时间按最早观测日期推定。
 */
export function normalizeLegacySettlement(legacy: LegacyObs[]): {
  observations: Observation[]
  rejected: RejectedSubmission[]
} {
  const sectionFirstDate = new Map<string, string>()
  for (const row of legacy) {
    const known = sectionFirstDate.get(row.section)
    if (!known || row.date < known) {
      sectionFirstDate.set(row.section, row.date)
    }
  }

  const expanded: RawObs[] = []
  const rejected: RejectedSubmission[] = []
  const acceptedKeys = new Set<string>()
  let nextId = 9001
  const sortedLegacy = [...legacy].sort((a, b) => a.id - b.id)

  for (const row of sortedLegacy) {
    const inferred = row.acceptedAt == null || row.acceptedAt === ''
    const acceptedAt = inferred ? sectionFirstDate.get(row.section) ?? row.date : String(row.acceptedAt)
    const key = `${row.section}|${row.date}|${row.increment ?? ''}`

    // 重复提交：同一断面 + 同一观测日期 + 同一增量，只认第一次落库。合并条先拆分再判断。
    if (!row.merged) {
      if (acceptedKeys.has(key)) {
        const kept = sortedLegacy.find(
          (other) =>
            other.id < row.id &&
            !other.merged &&
            other.section === row.section &&
            other.date === row.date &&
            (other.increment ?? null) === (row.increment ?? null),
        )
        rejected.push({
          id: nextId++,
          code: row.code,
          section: row.section,
          date: row.date,
          increment: round1(Number(row.increment ?? 0)),
          submittedAt: acceptedAt,
          reason: '同一笔观测重复提交，仅认第一次落库，整笔按重复退回',
          keptCode: kept?.code ?? row.code,
        })
        continue
      }
      acceptedKeys.add(key)
    }

    const threshold = round1(Number(row.threshold ?? DEFAULT_THRESHOLD))
    const operator = row.operator && row.operator.trim() !== '' ? row.operator : MISSING_OPERATOR
    const base = { section: row.section, threshold, operator, acceptedAt, inferredAcceptedAt: inferred }

    if (row.merged === 2) {
      // 早年把两次观测写成一条：合并增量均分（尾差并入后一次），拆开后各自是独立观测。
      const dates = row.splitDates ?? [shiftDate(row.date, 14), row.date]
      const total = round1(Number(row.mergedIncrement ?? 0))
      const first = round1(total / 2)
      const second = round1(total - first)
      const half = (inc: number, date: string, suffix: string): RawObs => ({
        ...base,
        code: `${row.code}-${suffix}`,
        date,
        increment: inc,
        archived: false,
        anchor: null,
        origin: '合并拆分',
        needsReview: true,
        reviewReason: '早年两次观测合并登记，增量按合并值均分推定，需补测核定',
        note: row.note ?? '由合并条拆分',
        legacyId: row.id,
      })
      expanded.push(half(first, dates[0], 'A'), half(second, dates[1], 'B'))
      continue
    }

    const missingIncrement = row.increment == null
    const missingOperator = operator === MISSING_OPERATOR
    // 归档件本身就是锚点读数：显式归档读数优先，否则采用归档条当次登记累计。
    const archivedValue = row.archived === true ? (row.archivedCumulative ?? row.recordedCumulative ?? 0) : null
    expanded.push({
      ...base,
      code: row.code,
      date: row.date,
      increment: round1(Number(row.increment ?? 0)),
      archived: row.archived === true,
      anchor: archivedValue == null ? null : round1(Number(archivedValue)),
      origin: '存量回填',
      needsReview: missingIncrement || missingOperator,
      reviewReason:
        missingIncrement && missingOperator
          ? '增量、监测人员缺登记，增量按 0 补入，需补测并补登人员'
          : missingIncrement
            ? '本次增量缺登记，按 0 补入，需补测核定'
            : missingOperator
              ? '监测人员缺登记，需补登'
              : '',
      note: row.note ?? '',
      legacyId: row.id,
    })
  }

  expanded.sort((a, b) =>
    a.section === b.section
      ? a.date === b.date
        ? a.legacyId - b.legacyId
        : a.date < b.date
          ? -1
          : 1
      : a.section < b.section
        ? -1
        : 1,
  )

  const observations: Observation[] = expanded.map((raw, index) => ({
    id: index + 1,
    code: raw.code,
    section: raw.section,
    date: raw.date,
    increment: raw.increment,
    cumulative: 0,
    rate: 0,
    threshold: raw.threshold,
    operator: raw.operator,
    archived: raw.archived,
    origin: raw.origin,
    needsReview: raw.needsReview,
    reviewReason: raw.reviewReason,
    note: raw.note,
    submitSeq: 1,
    acceptedAt: raw.acceptedAt,
    inferredAcceptedAt: raw.inferredAcceptedAt,
    ...(raw.anchor == null ? {} : { anchor: raw.anchor }),
  })) as (Observation & { anchor?: number })[]

  recomputeChain(observations as (Observation & { anchor?: number | null })[])
  return { observations, rejected }
}

/** 在不覆盖既有待查原因的前提下补一条核定提示。 */
function flagReview(obs: Observation & { anchor?: number | null }, reason: string): void {
  if (!obs.needsReview) {
    obs.needsReview = true
    obs.reviewReason = reason
  } else if (!obs.reviewReason.includes(reason)) {
    obs.reviewReason = `${obs.reviewReason}；${reason}`
  }
}

/**
 * 唯一口径：按断面分组，沿增量链统一重算累计沉降量与沉降速率。
 * - 历史取值有争议时以归档件为准：归档观测的累计取归档读数（锚点），
 *   锚点之间、最后锚点之后按登记增量顺推，第一个锚点之前沿增量链回推；
 * - 锚点间用登记增量推算出的值若与后一锚点归档读数不符，说明增量也被错登，
 *   改以两个归档读数之差作为该段增量并挂待查（归档件优先，不靠臆测摊派）；
 * - 沉降速率只取「本次增量 ÷ 与上一次观测的间隔天数」，首测为 0，绝不跨行叠加；
 * - 同一断面只算一次，列表/详情/导出都走这里。
 */
export function recomputeChain(rows: (Observation & { anchor?: number | null })[]): void {
  const groups = new Map<string, (Observation & { anchor?: number | null })[]>()
  for (const obs of rows) {
    const list = groups.get(obs.section) ?? []
    list.push(obs)
    groups.set(obs.section, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))

    // 断面阈值/人员缺项随同断面已知值补齐。
    const knownThreshold = list.find((o) => o.threshold !== DEFAULT_THRESHOLD)?.threshold
    const knownOperator = list.find((o) => o.operator && o.operator !== MISSING_OPERATOR)?.operator

    // 归档锚点（按观测日期升序）：每一份归档件都定住该点累计。
    const anchors = list
      .map((obs, idx) => ({ idx, value: (obs.anchor ?? null) as number | null, archived: obs.archived }))
      .filter((item) => item.archived || item.value != null)
      .map((item) => ({ idx: item.idx, value: round1(item.value ?? list[item.idx].cumulative) }))

    list.forEach((obs, idx) => {
      if (knownThreshold && obs.threshold === DEFAULT_THRESHOLD) {
        obs.threshold = knownThreshold
      }
      if (knownOperator && obs.operator === MISSING_OPERATOR) {
        obs.operator = `${knownOperator}（推定）`
        flagReview(obs, '监测人员按同断面观测人推定，需补登确认')
      }
      const span = idx === 0 ? 0 : daySpan(list[idx - 1].date, obs.date)
      obs.rate = idx === 0 || span <= 0 ? 0 : round2(obs.increment / span)
    })

    if (anchors.length === 0) {
      // 无归档件：首测累计取首测增量（相对基准点的首期沉降，缺项增量按 0 补即为 0），
      // 其余观测由增量链顺推。
      list[0].cumulative = round1(list[0].increment)
      for (let idx = 1; idx < list.length; idx++) {
        list[idx].cumulative = round1(list[idx - 1].cumulative + list[idx].increment)
      }
    } else {
      const first = anchors[0]
      // 第一个锚点之前：从锚点沿登记增量回推（首测锚点自身直接取归档值）。
      for (let idx = first.idx; idx >= 0; idx--) {
        list[idx].cumulative = idx === first.idx ? first.value : round1(list[idx + 1].cumulative - list[idx + 1].increment)
      }
      if (list[0].cumulative < 0) {
        flagReview(list[0], '按归档件回推首测累计为负值，需核对增量链与归档读数')
      }
      // 锚点之间：先用登记增量顺推，与下一锚点不符则以两份归档读数之差重定该段增量。
      for (let k = 0; k < anchors.length - 1; k++) {
        const a = anchors[k]
        const b = anchors[k + 1]
        for (let idx = a.idx + 1; idx < b.idx; idx++) {
          list[idx].cumulative = round1(list[idx - 1].cumulative + list[idx].increment)
        }
        const reached = round1(list[b.idx - 1].cumulative + list[b.idx].increment)
        if (Math.abs(reached - b.value) > 0.05) {
          const corrected = round1(b.value - list[b.idx - 1].cumulative)
          const oldIncrement = list[b.idx].increment
          list[b.idx].increment = corrected
          list[b.idx].rate = (() => {
            const span = daySpan(list[b.idx - 1].date, list[b.idx].date)
            return span > 0 ? round2(corrected / span) : 0
          })()
          flagReview(list[b.idx], `登记增量${fmtSigned(oldIncrement)}mm 与归档读数不符，按两份归档件之差改记 ${fmtSigned(corrected)}mm`)
        }
        list[b.idx].cumulative = b.value
      }
      // 最后一个锚点之后：按登记增量顺推。
      const last = anchors[anchors.length - 1]
      for (let idx = last.idx + 1; idx < list.length; idx++) {
        list[idx].cumulative = round1(list[idx - 1].cumulative + list[idx].increment)
      }
    }

    for (const obs of list) {
      delete obs.anchor
    }
  }
}

function fmtSigned(value: number): string {
  return String(value)
}

/** 断面聚合：同一断面只出一行。状态由最新累计与阈值自动判定，不采用老系统状态字段。 */
export function buildSections(observations: Observation[]): SectionView[] {
  const groups = new Map<string, Observation[]>()
  for (const obs of observations) {
    const list = groups.get(obs.section) ?? []
    list.push(obs)
    groups.set(obs.section, list)
  }
  const sections: SectionView[] = []
  for (const [section, list0] of groups) {
    const list = [...list0].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
    const latest = list[list.length - 1]
    sections.push({
      section,
      code: latest.code,
      acceptedAt: latest.acceptedAt,
      inferredAcceptedAt: latest.inferredAcceptedAt,
      cumulative: latest.cumulative,
      rate: latest.rate,
      threshold: latest.threshold,
      latestDate: latest.date,
      operator: latest.operator,
      status: latest.cumulative > latest.threshold ? '超限预警' : '沉降正常',
      observationCount: list.length,
      observations: list,
      archived: list.some((o) => o.archived),
      needsReview: list.some((o) => o.needsReview),
    })
  }
  // 既有条目按验收日期归位（升序）；验收日期为推定的同样参与，仅在界面上标注。
  return sections.sort((a, b) =>
    a.acceptedAt === b.acceptedAt ? (a.section < b.section ? -1 : 1) : a.acceptedAt < b.acceptedAt ? -1 : 1,
  )
}

/** 异常待查台账：超限断面 + 所有待核定观测，三处入口同源读取。 */
export function buildReviewLedger(sections: SectionView[]): ReviewItem[] {
  const items: ReviewItem[] = []
  for (const section of sections) {
    if (section.status === '超限预警') {
      items.push({
        section: section.section,
        code: section.code,
        date: section.latestDate,
        cumulative: section.cumulative,
        rate: section.rate,
        threshold: section.threshold,
        conclusion: `超限预警：累计 ${fmt1(section.cumulative)}mm 超阈值 ${fmt1(section.threshold)}mm，已同步设施检修待办`,
        source: '断面判定',
      })
    }
    for (const obs of section.observations) {
      if (obs.needsReview) {
        items.push({
          section: obs.section,
          code: obs.code,
          date: obs.date,
          cumulative: obs.cumulative,
          rate: obs.rate,
          threshold: obs.threshold,
          conclusion: obs.reviewReason,
          source: obs.origin,
        })
      }
    }
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

function fmt1(value: number): string {
  return String(round1(value))
}
