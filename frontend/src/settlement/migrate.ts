import type { StructuredLegacyResult } from './legacy-seed'
import type {
  ActionLog,
  LedgerEntry,
  Observation,
  ProcessingNote,
  Section,
  SectionArchive,
  SettlementState,
} from './types'
import { round1 } from './canonical'

/**
 * 存量成果一次性回填（幂等：只在 migrated=false 时执行一次）。
 *
 * 处理规则（与页面上「沉降数据处理说明」一致）：
 * - 按监测日期回填观测，既有条目按验收日期归位、按验收日期排序；
 * - 早年把两次观测写成一条（并记）：按并记顺序拆成两条；同日按上午=次别1、下午=次别2区分，
 *   拆分记录标注「并记拆分」，累计/速率只取断面最新读数，绝不叠加；
 * - 缺项：缺高程按相邻两次有读数的观测做线性内插，区间两端都缺则留空转待查；
 *   缺监测人员补「未登记」并转待查台账；
 * - 历史取值有争议：以归档件数值为准，其余口径按它统一重算；
 * - 早年没有登记时间：取该断面最早一次动作日志的发生时间推定，依据标注「最早动作推定」。
 */

let obsSeq = 1
let actionSeq = 1
function nextObsId(): number {
  obsSeq += 1
  return obsSeq - 1
}
function nextActionId(): number {
  actionSeq += 1
  return actionSeq - 1
}

function makeActions(
  code: string,
  acceptedDate: string,
  acceptedAt: string,
  extra: Array<{ date: string; action: string; operator: string; note?: string }>,
): ActionLog[] {
  const logs: ActionLog[] = [
    {
      id: nextActionId(),
      sectionCode: code,
      date: acceptedDate,
      action: '验收归位',
      operator: '系统回填',
      note: '存量成果按验收日期归位',
    },
    {
      id: nextActionId(),
      sectionCode: code,
      date: acceptedDate,
      action: '首次监测',
      operator: '系统回填',
      note: acceptedAt ? `登记时间 ${acceptedAt}` : '早年无登记时间，待推定',
    },
    ...extra.map((item) => ({ id: nextActionId(), sectionCode: code, ...item })),
  ]
  return logs
}

/** 线性内插：按缺失点在前后两个观测日之间的天数比例补高程 */
function interpolate(
  prev: { date: string; elev: number },
  next: { date: string; elev: number },
  targetDate: string,
): number {
  const total = Date.parse(`${next.date}T00:00:00`) - Date.parse(`${prev.date}T00:00:00`)
  const offset = Date.parse(`${targetDate}T00:00:00`) - Date.parse(`${prev.date}T00:00:00`)
  const ratio = total > 0 ? offset / total : 0
  return Math.round((prev.elev + (next.elev - prev.elev) * ratio) * 1000) / 1000
}

export function buildMigratedState(legacy: StructuredLegacyResult[]): SettlementState {
  const sections: Section[] = []
  const observations: Observation[] = []
  const archives: SectionArchive[] = []
  const actionLogs: ActionLog[] = []
  const ledger: LedgerEntry[] = []
  const notes: ProcessingNote[] = []

  legacy.forEach((item, index) => {
    const code = item.监测断面
    const registeredAt = item.登记时间 ?? ''
    const section: Section = {
      id: index + 1,
      code,
      name: item.断面名称 ?? `${code}监测断面`,
      thresholdMm: item.预警阈值,
      status: item.监测状态,
      acceptedDate: item.验收日期 ?? item.首次观测日期,
      registeredAt,
      registeredBasis: item.登记时间 ? '验收日期' : '最早动作推定',
    }
    sections.push(section)

    // 首次观测（建点基准）
    observations.push({
      id: nextObsId(),
      sectionCode: code,
      date: item.首次观测日期,
      seq: 1,
      elevation: item.首次高程m,
      operator: item.监测人员,
      source: '正常登记',
      note: '首次观测，作为累计沉降量基准',
      submittedAt: `${item.首次观测日期}T09:00:00`,
    })

    // 回填原始观测，并记拆分 / 缺项补项在这里处理
    const sorted = [...item.原始观测].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq ?? 1) - (b.seq ?? 1),
    )
    sorted.forEach((raw) => {
      if (raw.kind === 'merged') {
        observations.push({
          id: nextObsId(),
          sectionCode: code,
          date: raw.date,
          seq: raw.seq ?? 1,
          elevation: raw.elev as number,
          operator: item.监测人员,
          source: '并记拆分',
          note: `并记拆分：${(raw.seq ?? 1) === 1 ? '上午' : '下午'}观测`,
          submittedAt: `${raw.date}T${(raw.seq ?? 1) === 1 ? '09' : '15'}:00:00`,
        })
        return
      }

      if (raw.kind === 'missing' || raw.elev === null) {
        const prevObs = [...observations]
          .reverse()
          .find((obs) => obs.sectionCode === code && !obs.interpolated)
        const nextRaw = sorted.find(
          (candidate) => candidate.date > raw.date && candidate.elev !== null,
        )
        if (prevObs && nextRaw) {
          const elev = interpolate(
            { date: prevObs.date, elev: prevObs.elevation },
            { date: nextRaw.date, elev: nextRaw.elev as number },
            raw.date,
          )
          observations.push({
            id: nextObsId(),
            sectionCode: code,
            date: raw.date,
            seq: 1,
            elevation: elev,
            operator: raw.operator?.trim() || '未登记',
            source: '内插补项',
            interpolated: true,
            note: `缺高程，按 ${prevObs.date} 与 ${nextRaw.date} 读数线性内插补项；缺监测人员`,
            submittedAt: `${raw.date}T00:00:00`,
          })
          notes.push({
            id: `note-${code}-fill`,
            category: '缺项补项',
            sectionCode: code,
            detail: `${raw.date} 缺高程、缺监测人员：高程按 ${prevObs.date}（${prevObs.elevation}m）与 ${nextRaw.date}（${
              nextRaw.elev
            }m）线性内插补为 ${elev}m；监测人员补「未登记」。内插值仅作参照，已转待查台账核实。`,
            date: raw.date,
          })
          ledger.push({
            id: `ledger-${code}-fill`,
            sourceModule: '结构沉降监测',
            refCode: item.监测编号,
            sectionCode: code,
            type: '缺项待查',
            status: '待查',
            detail: `${raw.date} 观测缺高程/监测人员，高程为线性内插值 ${elev}m，需向监测原始记录本核实`,
            snapshotMm: null,
            foundAt: `${raw.date}T00:00:00`,
          })
        } else {
          notes.push({
            id: `note-${code}-fill`,
            category: '缺项补项',
            sectionCode: code,
            detail: `${raw.date} 缺高程，前后读数不足无法内插，保留缺项并转待查台账。`,
            date: raw.date,
          })
          ledger.push({
            id: `ledger-${code}-fill`,
            sourceModule: '结构沉降监测',
            refCode: item.监测编号,
            sectionCode: code,
            type: '缺项待查',
            status: '待查',
            detail: `${raw.date} 观测缺高程，无相邻读数可内插，暂不参与计算`,
            snapshotMm: null,
            foundAt: `${raw.date}T00:00:00`,
          })
        }
        return
      }

      observations.push({
        id: nextObsId(),
        sectionCode: code,
        date: raw.date,
        seq: raw.seq ?? 1,
        elevation: raw.elev,
        operator: raw.operator?.trim() || item.监测人员,
        source: '正常登记',
        submittedAt: `${raw.date}T10:00:00`,
      })
    })

    // 断面动作日志（额外事件按断面挂接）
    const extraLogs: Array<{ date: string; action: string; operator: string; note?: string }> = []
    if (code === 'DMI-01') {
      extraLogs.push(
        { date: '2023-05-20', action: '提交监测', operator: '王建国', note: '两次观测被并记为一条' },
        { date: '2023-05-21', action: '标记预警', operator: '王建国', note: '旧口径按叠加值判超限' },
      )
    }
    if (code === 'DMI-02') {
      extraLogs.push(
        { date: '2023-06-11', action: '提交监测', operator: '李慧敏' },
        { date: '2024-01-15', action: '取值争议', operator: '系统回填', note: '页面33/导出44/台账30 三方不一致' },
        { date: '2024-02-01', action: '归档裁定', operator: '档案室', note: '以归档件 SD-2024-007 的 22mm 为准' },
      )
    }
    if (code === 'DMI-03') {
      extraLogs.push(
        { date: '2023-08-18', action: '提交监测', operator: '未登记', note: '缺监测人员' },
        { date: '2023-09-05', action: '判定正常', operator: '赵志强' },
      )
    }
    if (code === 'DMI-04') {
      extraLogs.push(
        { date: '2024-05-10', action: '提交监测', operator: '周明' },
        { date: '2024-05-10', action: '重复提交', operator: '周明', note: '第二笔整笔退回，只认第一次落库' },
      )
    }
    const logs = makeActions(code, section.acceptedDate, registeredAt, extraLogs)
    actionLogs.push(...logs)

    // 无登记时间：取最早一次动作的发生时间推定
    if (!registeredAt) {
      const earliest = logs.map((log) => `${log.date}T00:00:00`).sort()[0]
      section.registeredAt = earliest
      notes.push({
        id: `note-${code}-regtime`,
        category: '登记时间推定',
        sectionCode: code,
        detail: `早年没有登记时间，按最早一次动作（${logs.sort((a, b) =>
          a.date < b.date ? -1 : 1,
        )[0].action}，${earliest.slice(0, 10)}）推定登记时间。`,
        date: earliest.slice(0, 10),
      })
    }

    // 并记拆分说明 + 待查台账
    const mergedCount = item.原始观测.filter((raw) => raw.kind === 'merged').length
    if (mergedCount > 0) {
      notes.push({
        id: `note-${code}-merged`,
        category: '并记拆分',
        sectionCode: code,
        detail: `2023-05-20 把上午/下午两次观测并写成一条：已按并记顺序拆为次别1（上午）、次别2（下午）两条；同一断面只算一次，累计沉降量取「首次高程−最新高程」，不做叠加。拆分结果转待查台账核对原始记录本。`,
        date: '2023-05-20',
      })
      ledger.push({
        id: `ledger-${code}-merged`,
        sourceModule: '结构沉降监测',
        refCode: item.监测编号,
        sectionCode: code,
        type: '并记拆分待查',
        status: '待查',
        detail: '两次观测并记为一条，已拆分为上午/下午两条，需核对原始监测记录本确认两次高程',
        snapshotMm: null,
        foundAt: '2023-05-20T00:00:00',
      })
    }
  })

  // 归档件：DMI-02 争议值裁决
  archives.push({
    sectionCode: 'DMI-02',
    docNo: 'SD-2024-007',
    title: '2号综合舱交叉口断面沉降年度归档表',
    archiveDate: '2024-02-01',
    cumulativeMm: 22,
    note: '页面33/导出44/台账30 三方争议，以本归档件 22mm 为权威值，其余入口按它统一重算',
  })
  notes.push({
    id: 'note-DMI-02-archive',
    category: '争议裁决',
    sectionCode: 'DMI-02',
    detail:
      '历史取值三方不一致（页面 33、导出 44、旧台账 30）：按归档件《2号综合舱交叉口断面沉降年度归档表》（SD-2024-007）裁定累计沉降量为 22mm，争议值作废；沉降速率仍按最近两次观测口径重算，不叠加。',
    date: '2024-02-01',
  })
  ledger.push({
    id: 'ledger-DMI-02-dispute',
    sourceModule: '结构沉降监测',
    refCode: 'SETT-2023-002',
    sectionCode: 'DMI-02',
    type: '取值争议',
    status: '已闭环',
    detail: '页面 33 / 导出 44 / 旧台账 30 三方争议，已按归档件 SD-2024-007 统一为 22mm',
    snapshotMm: 33,
    foundAt: '2024-01-15T09:00:00',
    closedAt: '2024-02-01T00:00:00',
    resolution: '以归档件 22mm 为准，列表/详情/导出/待查台账全部重算一致',
  })

  return {
    version: 1,
    sections,
    observations,
    archives,
    actionLogs,
    ledger,
    submissions: [],
    notes,
    migrated: true,
  }
}

/** 供导出/核对使用的处理说明摘要（带编号，页面与文档同源） */
export function noteSummary(notes: ProcessingNote[]): string {
  return notes
    .map((note) => `[${note.category}] ${note.sectionCode}：${note.detail}`)
    .join('\n')
}

export { round1 }
