import type {
  CanonicalResult,
  Observation,
  Section,
  SectionArchive,
} from './types'

/** 毫米换算：高程以 m 存储，展示与导出统一为 mm */
const MM_PER_M = 1000

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 两个 yyyy-MM-dd 日期之间的整天数（b - a） */
export function daySpan(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00`)
  const tb = Date.parse(`${b}T00:00:00`)
  return Math.round((tb - ta) / 86_400_000)
}

export function nowStamp(): string {
  return new Date().toISOString()
}

/**
 * 计算一个断面在统一口径下的成果读数。
 *
 * 口径（页面、详情、导出、台账共用，任何入口不得另算）：
 * - 累计沉降量 = 首次观测高程 − 最新观测高程，单次相减；同一断面只算一次，绝不按观测次数叠加；
 * - 沉降速率 = 最近两个不同观测日之间的区间速率 (mm/d)；
 *   同一天的并记拆分记录只反映当日变化，不参与速率，杜绝「两次观测叠加」；
 * - 归档件给出权威累计沉降量时，争议值作废，以归档件为准，其余派生口径仍按观测重算；
 * - 内插补项的读数参与计算但标注来源，方便对方照明细核对。
 */
export function computeCanonical(
  section: Section,
  observations: Observation[],
  archive?: SectionArchive,
): CanonicalResult {
  const list = observations
    .filter((item) => item.sectionCode === section.code)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq,
    )

  if (list.length === 0) {
    return {
      section,
      firstDate: '',
      latestDate: '',
      observationCount: 0,
      cumulativeMm: 0,
      valueSource: archive ? '归档件' : '观测重算',
      rateMmPerDay: null,
      rateFromDate: null,
      rateToDate: null,
      overLimit: false,
    }
  }

  const first = list[0]
  const latest = list[list.length - 1]
  const observedCumulative = (first.elevation - latest.elevation) * MM_PER_M

  // 速率：最近两个「不同观测日」的高程差 / 天数。
  // 取最新一天的最后一笔，再向前找到上一个不同日期的最后一笔。
  let rate: number | null = null
  let rateFrom: Observation | null = null
  for (let i = list.length - 2; i >= 0; i -= 1) {
    if (list[i].date !== latest.date) {
      rateFrom = list[i]
      break
    }
  }
  if (rateFrom) {
    const days = daySpan(rateFrom.date, latest.date)
    if (days > 0) {
      rate = round1(((rateFrom.elevation - latest.elevation) * MM_PER_M) / days)
    }
  }

  const fromArchive = Boolean(archive)
  const cumulative = archive ? archive.cumulativeMm : round1(observedCumulative)

  return {
    section,
    firstDate: first.date,
    latestDate: latest.date,
    observationCount: list.length,
    cumulativeMm: cumulative,
    valueSource: fromArchive ? '归档件' : '观测重算',
    rateMmPerDay: rate,
    rateFromDate: rateFrom ? rateFrom.date : null,
    rateToDate: latest.date,
    overLimit: cumulative > section.thresholdMm,
  }
}

/** 全量断面成果，按验收日期（归位口径）升序；页面条数与导出条数都取它的长度。 */
export function computeAllCanonical(
  sections: Section[],
  observations: Observation[],
  archives: SectionArchive[],
): CanonicalResult[] {
  const archiveByCode = new Map(archives.map((item) => [item.sectionCode, item]))
  return [...sections]
    .sort((a, b) =>
      a.acceptedDate < b.acceptedDate ? -1 : a.acceptedDate > b.acceptedDate ? 1 : a.id - b.id,
    )
    .map((section) =>
      computeCanonical(
        section,
        observations,
        archiveByCode.get(section.code),
      ),
    )
}

/** FNV-1a 32 位校验码：导出文件每次重导都应一致，对方可据此核对 */
export function checksum(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** CSV 单元格转义：含逗号/引号/换行的内容加双引号 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
