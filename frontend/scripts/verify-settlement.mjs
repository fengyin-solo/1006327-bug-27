/**
 * 沉降口径核对脚本（node 运行，不依赖浏览器）：
 *   cd frontend && node scripts/verify-settlement.mjs
 *
 * 校验：统一口径读数、并记拆分不叠加、归档裁决、内插补项、登记时间推定、
 * 重复提交只认第一次、导出重导一致（含校验码）、报表与明细对得上、检修待办按新值重排。
 */
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const entry = join(mkdtempSync(join(tmpdir(), 'settle-')), 'entry.ts')
writeFileSync(
  entry,
  `
export * from '@/settlement/service'
export { computeAllCanonical, checksum, daySpan } from '@/settlement/canonical'
export { buildMigratedState } from '@/settlement/migrate'
export { LEGACY_RESULTS } from '@/settlement/legacy-seed'
`,
)

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  alias: { '@': join(process.cwd(), 'src') },
})
const outFile = join(tmpdir(), `settle-bundle-${Date.now()}.mjs`)
writeFileSync(outFile, result.outputFiles[0].text)
const mod = await import(pathToFileURL(outFile).href)

// ---- 极简 localStorage 垫片（store 首次加载即初始化）----
const memory = new Map()
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
}

let failures = 0
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`)
  if (!pass) failures += 1
}

// 初始化（main.ts 等价动作）
mod.ensureSettlementReady()
let view = mod.settlementView()
const byCode = Object.fromEntries(view.results.map((r) => [r.section.code, r]))

// 1) 统一口径：DMI-01 并记拆分后累计 45mm（20.000-19.955），不是旧列表22/导出44/详情33
check('DMI-01 累计沉降量取单次相减（非22/44/33）', byCode['DMI-01'].cumulativeMm, 45)
check('DMI-01 超限（阈值30）', byCode['DMI-01'].overLimit, true)
// 速率只取最近两个不同观测日：05-20(取19.956) -> 06-15(19.955) = 1mm/26d
check('DMI-01 速率不叠加，取最近区间(mm/d)', byCode['DMI-01'].rateMmPerDay, 0)
check('DMI-01 速率区间日期', [byCode['DMI-01'].rateFromDate, byCode['DMI-01'].rateToDate], ['2023-05-20', '2023-06-15'])

// 2) DMI-02 争议以归档件 22mm 为准
check('DMI-02 归档裁决为22（非33/44/30）', byCode['DMI-02'].cumulativeMm, 22)
check('DMI-02 取值来源=归档件', byCode['DMI-02'].valueSource, '归档件')
check('DMI-02 按22mm判正常', byCode['DMI-02'].overLimit, false)

// 3) DMI-03 缺项内插：按天数加权 15.000→14.993（104/119）得 14.994；
//    最新累计 = 15.000-14.993 = 7mm
check('DMI-03 累计沉降量7mm', byCode['DMI-03'].cumulativeMm, 7)
const d3 = view.observations.filter((o) => o.sectionCode === 'DMI-03')
const interp = d3.find((o) => o.interpolated)
check('DMI-03 缺项已线性内插', interp ? interp.elevation : null, 14.994)
check('DMI-03 内插标注来源', interp ? interp.source : null, '内插补项')
check('DMI-03 缺人员补未登记', interp ? interp.operator : null, '未登记')

// 4) 登记时间推定：DMI-03 无登记时间 -> 最早动作 2023-05-06
const d3section = view.sections.find((s) => s.code === 'DMI-03')
check('DMI-03 登记时间按最早动作推定', d3section.registeredAt.slice(0, 10), '2023-05-06')
check('DMI-03 归位依据标注', d3section.registeredBasis, '最早动作推定')

// 5) 并记拆分：DMI-01 同日有 seq=1/2 两条
const d1obs = view.observations.filter((o) => o.sectionCode === 'DMI-01')
check('DMI-01 并记拆为同日两条', d1obs.filter((o) => o.date === '2023-05-20').map((o) => o.seq), [1, 2])
check('DMI-01 拆分记录有标注', d1obs.filter((o) => o.date === '2023-05-20').every((o) => o.source === '并记拆分'), true)

// 6) 重复提交：DMI-04 只落一笔，第二笔 rejected_duplicate
const d4subs = view.submissions.filter((s) => s.sectionCode === 'DMI-04').map((s) => s.outcome)
check('DMI-04 第一次落库/第二笔退回', d4subs, ['accepted', 'rejected_duplicate'])
check('DMI-04 观测为首次+落库共2笔（重复未写入）', view.observations.filter((o) => o.sectionCode === 'DMI-04').length, 2)

// 7) 页面断面成果只有 4 条（同一断面只算一次）
check('断面成果条数=4', view.results.length, 4)

// 8) 导出确定性：连导两次内容字节一致，且条数与页面一致
const exp1 = mod.exportSettlement()
const exp2 = mod.exportSettlement()
check('重导内容完全一致', exp1.content, exp2.content)
check('导出断面数=页面断面数', exp1.summary.sectionCount, view.results.length)
check('导出观测笔数=领域观测总数', exp1.summary.observationCount, view.observations.length)
check('导出文件名稳定', exp1.filename, '结构沉降监测成果清单.csv')
const lines1 = exp1.content.split('\n')
check('导出含校验码行', lines1[lines1.length - 1].startsWith('校验码,'), true)
check('导出含报表-明细对账一致', lines1.some((l) => l.startsWith('核对,明细观测笔数,') && l.endsWith('一致')), true)
check('导出含超限-检修待办对账', lines1.some((l) => l.startsWith('核对,超限断面数,')), true)
check('导出按断面分组（含小计）', lines1.filter((l) => l.startsWith('小计,DMI-')).length, 4)

// 9) 检修同步：只有 DMI-01 超限 -> 一条待办 MAIN-SETT-01，按沉降值排队
const maintRows = mod.maintenanceRowsSorted()
const synced = maintRows.filter((r) => r['关联断面'])
check('检修同步待办数=超限断面数=1', synced.length, 1)
check('同步待办编号', synced[0]['检修编号'], 'MAIN-SETT-01')
check('同步待办读数=统一口径45mm', synced[0]['累计沉降量mm'], 45)
check('同步待办优先级=高(45/30>=1.3)', synced[0]['检修优先级'], '高')

// 10) 给「监测中」的 DMI-04 提交一笔超限观测：应自动判预警并同步，待办按沉降值重排
// DMI-04 首次高程 16.500，提交 16.450 -> 累计 50mm > 阈值 20
const intake = mod.acceptObservation({ sectionCode: 'DMI-04', date: '2024-06-01', elevation: 16.45, operator: '测试员' })
check('超限观测提交成功', intake.ok, true)
check('提交回执含检修同步信息', intake.message.includes('已同步检修待办'), true)
const afterIntake = mod.settlementView().results.find((r) => r.section.code === 'DMI-04')
check('DMI-04 提交即自动预警', afterIntake.section.status, '超限预警')
let rows2 = mod.maintenanceRowsSorted().filter((r) => r['关联断面'] && r.status !== '已关闭')
check('超限后同步待办变为2条', rows2.length, 2)
// 50mm 的 DMI-04 应排在 45mm 的 DMI-01 前面
check('待办按最新沉降值降序重排', rows2.map((r) => r['关联断面']), ['DMI-04', 'DMI-01'])
check('DMI-04 待办读数更新为50mm', rows2[0]['累计沉降量mm'], 50)

// 11) 恢复正常 -> 待办自动关闭
mod.changeSectionStatus('DMI-01', '判定正常', '测试员')
const closed = mod.maintenanceRowsSorted().filter((r) => r['关联断面'] === 'DMI-01')[0]
check('DMI-01 恢复正常后待办关闭', closed.status, '已关闭')

// 12) 再来一笔重复提交走在线通道：整笔退回，观测数不变
const before = mod.settlementView().observations.length
const dup = mod.acceptObservation({ sectionCode: 'DMI-04', date: '2024-06-01', elevation: 16.45, operator: '测试员' })
const after = mod.settlementView().observations.length
check('在线重复提交被识别', dup.ok, false)
check('在线重复提交未新增观测', after, before)

// 13) 待查台账：超限/重复/并记/缺项/争议全部回写
const ledger = mod.settlementView().ledger
const types = Array.from(new Set(ledger.map((l) => l.type))).sort()
check('台账覆盖五类异常', types.sort(), ['并记拆分待查', '取值争议', '缺项待查', '超限预警', '重复提交'].sort())
check('台账超限读数快照=50mm(同源)', ledger.find((l) => l.type === '超限预警' && l.sectionCode === 'DMI-04').snapshotMm, 50)

console.log(failures === 0 ? '\n全部核对通过 ✅' : `\n${failures} 项未通过 ❌`)
process.exit(failures === 0 ? 0 : 1)
