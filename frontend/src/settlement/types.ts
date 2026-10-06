/**
 * 沉降领域的公共类型。
 *
 * 口径说明（与《沉降数据处理说明》一致）：
 * - 一个「监测断面」对应一条沉降成果；断面下有多次「观测记录」。
 * - 累计沉降量 = 首次观测高程 − 最新观测高程（单次相减，不按观测次数叠加）。
 * - 沉降速率 = 最近两次观测的区间速率（mm/d），同样不叠加。
 * - 历史取值有争议时以归档件为准：归档数值直接覆盖重算值。
 */

/** 单次观测记录（同一断面一天可有上午/下午两次） */
export type Observation = {
  id: number
  /** 断面业务编号，如 DMI-01 */
  sectionCode: string
  date: string
  /** 当日观测次别：首次观测为 1，第二次为 2；用于并记拆分与重复指纹 */
  seq: number
  /** 测点高程，单位 m，保留三位小数 */
  elevation: number
  operator: string
  /** 数据来源：正常登记 / 并记拆分 / 内插补项 / 归档权威 */
  source: '正常登记' | '并记拆分' | '内插补项' | '归档权威'
  /** 内插得到的记录没有原始观测，读数仅供参照 */
  interpolated?: boolean
  note?: string
  /** 落库时间，重复判定时只认最早的一笔 */
  submittedAt: string
}

/** 归档件：历史取值有争议时的权威来源 */
export type SectionArchive = {
  sectionCode: string
  docNo: string
  title: string
  archiveDate: string
  /** 归档累计沉降量（mm）；存在即以此为准 */
  cumulativeMm: number
  note?: string
}

/** 断面条目（一个断面一条成果） */
export type Section = {
  id: number
  code: string
  name: string
  /** 预警阈值，单位 mm；累计沉降量超过即为超限 */
  thresholdMm: number
  /** 人工状态：待监测 / 监测中 / 沉降正常 / 超限预警 */
  status: string
  /** 既有条目按验收日期归位 */
  acceptedDate: string
  /** 登记时间；早年缺失时取最早一次动作的发生时间 */
  registeredAt: string
  /** 归位依据：验收日期 / 最早动作推定 */
  registeredBasis: '验收日期' | '最早动作推定'
}

/** 断面动作日志：状态流转与预警都在这里留痕，最早一条用来推定登记时间 */
export type ActionLog = {
  id: number
  sectionCode: string
  date: string
  action: string
  operator: string
  note?: string
}

/** 统一口径下的断面成果读数：列表 / 详情 / 导出 / 台账全部取这一份 */
export type CanonicalResult = {
  section: Section
  /** 首次观测日期 */
  firstDate: string
  latestDate: string
  observationCount: number
  /** 累计沉降量（mm），已按归档件权威值裁决 */
  cumulativeMm: number
  /** 数值来源：观测重算 / 归档件 */
  valueSource: '观测重算' | '归档件'
  /** 最近一次区间沉降速率（mm/d），并记拆分当日不参与 */
  rateMmPerDay: number | null
  rateFromDate: string | null
  rateToDate: string | null
  overLimit: boolean
}

/** 待查台账条目（异常结论回写处，其余入口也读这份） */
export type LedgerEntry = {
  id: string
  sourceModule: string
  refCode: string
  sectionCode?: string
  type: string
  /** 待查 / 已闭环 */
  status: '待查' | '已闭环'
  detail: string
  /** 发生时快照读数 */
  snapshotMm: number | null
  /** 发生时间 */
  foundAt: string
  closedAt?: string
  resolution?: string
}

/** 提交受理记录：同一笔重复提交只认第一次落库 */
export type SubmissionRecord = {
  id: number
  fingerprint: string
  sectionCode: string
  date: string
  seq: number
  elevation: number
  operator: string
  /** accepted=第一次落库；rejected_duplicate=整笔按重复退回 */
  outcome: 'accepted' | 'rejected_duplicate'
  message: string
  submittedAt: string
}

/** 处理说明条目（存量回填 / 补项 / 争议裁决的逐条留痕） */
export type ProcessingNote = {
  id: string
  category: '并记拆分' | '缺项补项' | '争议裁决' | '登记时间推定' | '重复退回' | '归档基准'
  sectionCode: string
  detail: string
  date: string
}

/** 回填用的早年原始成果（包含把两次观测写成一条等脏数据） */
export type LegacyResult = {
  监测编号: string
  监测断面: string
  断面名称?: string
  累计沉降量: string
  沉降速率: string
  预警阈值: number
  监测日期: string
  监测人员: string
  监测状态: string
  验收日期?: string
  登记时间?: string
  备注?: string
}

/** 沉降领域的全部持久化状态 */
export type SettlementState = {
  version: number
  sections: Section[]
  observations: Observation[]
  archives: SectionArchive[]
  actionLogs: ActionLog[]
  ledger: LedgerEntry[]
  submissions: SubmissionRecord[]
  notes: ProcessingNote[]
  migrated: boolean
}
