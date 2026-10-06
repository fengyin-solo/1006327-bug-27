/** 结构沉降监测领域模型：列表、详情、导出、检修联动、待查台账共用同一份口径。 */

/** 数据来源：区分正常登记、存量回填、早年合并条拆分、重复退回。 */
export type ObsOrigin = '正常登记' | '存量回填' | '合并拆分' | '重复退回'

/** 归一化后的最小粒度：一条 = 一个监测断面的一次观测，绝不再出现一条两次观测。 */
export interface Observation {
  /** 归一化后稳定 ID，重复导出不会变。 */
  id: number
  /** 监测编号；合并拆分条在原编号后加 -A/-B。 */
  code: string
  /** 监测断面（断面分组键）。 */
  section: string
  /** 本次观测日期 YYYY-MM-DD。 */
  date: string
  /** 本次沉降增量 mm（相邻两次观测之差；首测为 0）。 */
  increment: number
  /** 截至本次的累计沉降量 mm——增量链统一重算值。 */
  cumulative: number
  /** 截至本次的沉降速率 mm/d——只取本次增量除以相邻观测间隔，不叠加。 */
  rate: number
  /** 预警阈值 mm；缺项按平台默认 30mm 补入。 */
  threshold: number
  /** 监测人员；缺项记「未登记（待补）」。 */
  operator: string
  /** 是否归档件读数；同断面历史取值有争议时以归档件为准。 */
  archived: boolean
  origin: ObsOrigin
  /** 是否需要补测/核定，进入待查台账。 */
  needsReview: boolean
  /** 待查/核定原因。 */
  reviewReason: string
  /** 备注（老系统错算说明等）。 */
  note: string
  /** 同一笔读数的提交次序，1 为首笔落库。 */
  submitSeq: number
  /** 验收/登记时间：既有条目取验收日期；缺登记时间的按最早一次动作推定。 */
  acceptedAt: string
  inferredAcceptedAt: boolean
}

/** 重复提交整笔退回的留痕。 */
export interface RejectedSubmission {
  id: number
  code: string
  section: string
  date: string
  increment: number
  submittedAt: string
  reason: string
  /** 同一笔中被认可落库的首笔编号。 */
  keptCode: string
}

/** 断面视图：同一断面只聚合一次，列表/导出小计/详情都取这一份。 */
export interface SectionView {
  section: string
  /** 最新一次观测的监测编号。 */
  code: string
  acceptedAt: string
  inferredAcceptedAt: boolean
  /** 断面累计沉降量 = 最新观测的链上累计值，不做跨行叠加。 */
  cumulative: number
  /** 断面沉降速率 = 最新观测速率。 */
  rate: number
  threshold: number
  latestDate: string
  operator: string
  status: '待监测' | '沉降正常' | '超限预警'
  observationCount: number
  observations: Observation[]
  /** 断面读数是否经归档件核定。 */
  archived: boolean
  needsReview: boolean
}

/** 异常待查台账条目：概览、检修、沉降三处同源。 */
export interface ReviewItem {
  section: string
  code: string
  date: string
  cumulative: number
  rate: number
  threshold: number
  /** 异常结论：超限预警 / 合并拆分推定待核 / 缺项待补 等。 */
  conclusion: string
  source: ObsOrigin | '断面判定'
}

/** 报表导出结果：纯函数产物，同一数据状态重复导出逐字节一致。 */
export interface SettlementReport {
  filename: string
  content: string
  sectionCount: number
  observationCount: number
  overLimitCount: number
  reviewCount: number
}
