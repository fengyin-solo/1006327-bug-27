/**
 * 存量沉降成果（模拟老系统导入的原始数据，故意保留当年的各种毛病）：
 * - SETT-0002：早年把两次观测写成一条（增量 8mm 合并登记）；
 * - SETT-0003：超限断面，页面/详情/导出三处读数不一致（44/33/22 问题的原型），且有归档件争议；
 * - SETT-0004：缺增量、缺人员、缺登记时间的缺项条；
 * - SETT-0005 / SETT-0006：同一笔观测重复提交两次。
 * 首次打开时由 normalizeLegacySettlement() 一次性迁移，之后浏览器里的迁移结果优先。
 */
export interface LegacyObs {
  id: number
  code: string
  section: string
  date: string
  /** 当次累计读数；缺项为 null。 */
  recordedCumulative: number | null
  /** 本次增量；老系统把两次观测写成一条时记成 2，值合并在 mergedIncrement 里。 */
  merged?: 2
  mergedIncrement?: number | null
  /** 普通条的本次增量，老系统也可能漏登（null）。 */
  increment?: number | null
  /** 归档件读数：有争议时以归档件为准（与 record* 分开保存，迁移不改原始存量）。 */
  archivedCumulative?: number | null
  /** 合并条当年留下的两次观测日期（早年台账笔迹可辨）。 */
  splitDates?: [string, string]
  threshold?: number | null
  operator?: string | null
  archived?: boolean
  /** 老系统状态：待监测/监测中/沉降正常/超限预警。 */
  status?: string
  acceptedAt?: string | null
  note?: string
  submitSeq?: number
}

export const LEGACY_SETTLEMENT: LegacyObs[] = [
  {
    id: 1,
    code: 'SETT-0001',
    section: 'K0+200 标准段',
    date: '2026-08-18',
    recordedCumulative: 0,
    increment: 0,
    threshold: 30,
    operator: '周明远',
    status: '沉降正常',
    acceptedAt: '2026-08-18',
  },
  {
    id: 2,
    code: 'SETT-0002',
    section: 'K0+200 标准段',
    date: '2026-09-16',
    recordedCumulative: 8,
    merged: 2,
    mergedIncrement: 8,
    splitDates: ['2026-09-02', '2026-09-16'],
    threshold: 30,
    operator: '周明远',
    status: '沉降正常',
    acceptedAt: '2026-09-16',
    note: '老系统将 09-02 与 09-16 两次观测合并登记为一条，增量未拆分',
  },
  {
    id: 3,
    code: 'SETT-0003',
    section: 'K0+200 标准段',
    date: '2026-09-28',
    recordedCumulative: 11,
    increment: 3,
    threshold: 30,
    operator: '周明远',
    status: '沉降正常',
    acceptedAt: '2026-09-28',
  },
  {
    id: 4,
    code: 'SETT-0004',
    section: 'K0+520 穿越段',
    date: '2026-05-10',
    recordedCumulative: 0,
    increment: 0,
    threshold: 30,
    operator: '李素芬',
    archived: true,
    status: '沉降正常',
    acceptedAt: '2026-05-10',
  },
  {
    id: 5,
    code: 'SETT-0005',
    section: 'K0+520 穿越段',
    date: '2026-05-24',
    // 争议读数：老系统列表按 22 算、导出按 44 算、详情按 33 算；归档件读数 22（增量 44 也是叠加错算）。
    recordedCumulative: 44,
    archivedCumulative: 22,
    archived: true,
    increment: 44,
    threshold: 30,
    operator: '李素芬',
    status: '超限预警',
    acceptedAt: '2026-05-24',
    note: '列表22/导出44/详情33，三处口径不一致，以归档件为准重算',
  },
  {
    id: 6,
    code: 'SETT-0006',
    section: 'K0+520 穿越段',
    date: '2026-06-08',
    recordedCumulative: 28,
    increment: 6,
    threshold: 30,
    operator: '李素芬',
    archived: true,
    status: '沉降正常',
    acceptedAt: '2026-06-08',
  },
  {
    id: 7,
    code: 'SETT-0007',
    section: 'K0+840 泵站接口',
    date: '2026-04-12',
    // 缺项：首测累计读数漏登、增量漏登、人员漏登、登记时间漏登。
    recordedCumulative: null,
    increment: null,
    threshold: null,
    operator: null,
    status: '监测中',
    acceptedAt: null,
    note: '老系统字段不全：增量、人员、登记时间缺失',
  },
  {
    id: 8,
    code: 'SETT-0008',
    section: 'K0+840 泵站接口',
    date: '2026-04-27',
    recordedCumulative: 6,
    increment: 6,
    threshold: null,
    operator: '丁文海',
    status: '监测中',
    acceptedAt: '2026-04-27',
  },
  {
    id: 9,
    code: 'SETT-0009',
    section: 'K0+840 泵站接口',
    date: '2026-05-12',
    recordedCumulative: 14,
    increment: 8,
    threshold: null,
    operator: '丁文海',
    status: '监测中',
    acceptedAt: '2026-05-12',
  },
  {
    id: 10,
    code: 'SETT-0010',
    section: 'K1+060 检查井',
    date: '2026-08-05',
    recordedCumulative: 8,
    increment: 8,
    threshold: 20,
    operator: '赵启山',
    status: '监测中',
    acceptedAt: '2026-08-05',
  },
  {
    id: 11,
    code: 'SETT-0011',
    section: 'K1+060 检查井',
    date: '2026-08-20',
    recordedCumulative: 33,
    increment: 25,
    threshold: 20,
    operator: '赵启山',
    status: '超限预警',
    acceptedAt: '2026-08-20',
    note: '导出旧逻辑把两次沉降速率叠加，累计被错算成 58',
  },
  {
    id: 12,
    code: 'SETT-0012',
    section: 'K1+300 交汇舱',
    date: '2026-07-02',
    recordedCumulative: 5,
    increment: 5,
    threshold: 30,
    operator: '孙雅琴',
    status: '沉降正常',
    acceptedAt: '2026-07-02',
  },
  {
    id: 13,
    code: 'SETT-0013',
    section: 'K1+300 交汇舱',
    date: '2026-07-16',
    recordedCumulative: 9,
    increment: 4,
    threshold: 30,
    operator: '孙雅琴',
    status: '沉降正常',
    acceptedAt: '2026-07-16',
  },
  // 同一笔观测重复提交：断面、日期、增量完全相同。首笔 SETT-0013 落库，本笔整笔退回。
  {
    id: 14,
    code: 'SETT-0013',
    section: 'K1+300 交汇舱',
    date: '2026-07-16',
    recordedCumulative: 9,
    increment: 4,
    threshold: 30,
    operator: '孙雅琴',
    status: '沉降正常',
    acceptedAt: '2026-07-16',
    note: '重复提交（网络重试）',
    submitSeq: 2,
  },
]
