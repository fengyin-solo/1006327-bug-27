<template>
  <section class="page" data-module="settlement">
    <header class="page-head">
      <div>
        <h2>结构沉降监测管理</h2>
        <p class="page-desc">
          一个监测断面一条成果：累计沉降量＝首次高程−最新高程（单次相减），沉降速率＝最近两个观测日的区间速率，
          列表、详情、导出、待查台账共用同一口径，不按观测次数叠加。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showRegister = true">登记沉降监测点</button>
        <button class="btn" type="button" @click="showIntake = true">提交观测</button>
        <button class="btn" type="button" @click="exportRows">按断面分组导出成果清单</button>
        <button class="btn ghost" type="button" @click="showNotes = !showNotes">
          {{ showNotes ? '收起处理说明' : '沉降数据处理说明' }}
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>监测断面</span>
        <input v-model="keyword" placeholder="按断面编号/名称检索" />
      </label>
      <label class="filter-item">
        <span>监测状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table settlement-table">
      <thead>
        <tr>
          <th>监测断面</th>
          <th>断面名称</th>
          <th>累计沉降量(mm)</th>
          <th>沉降速率(mm/d)</th>
          <th>速率区间</th>
          <th>预警阈值(mm)</th>
          <th>首次/最新观测</th>
          <th>观测笔数</th>
          <th>取值来源</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="result in filtered" :key="result.section.code" :class="{ 'row-warning': result.overLimit }">
          <td><button class="link" type="button" @click="openDetail(result.section.code)">{{ result.section.code }}</button></td>
          <td>{{ result.section.name }}</td>
          <td class="num strong">{{ result.cumulativeMm }}</td>
          <td class="num">{{ result.rateMmPerDay === null ? '—' : result.rateMmPerDay }}</td>
          <td>{{ result.rateFromDate ? `${result.rateFromDate}~${result.rateToDate}` : '—' }}</td>
          <td class="num">{{ result.section.thresholdMm }}</td>
          <td>{{ result.firstDate || '—' }} / {{ result.latestDate || '—' }}</td>
          <td class="num">{{ result.observationCount }}</td>
          <td>
            <span class="source-tag" :class="result.valueSource === '归档件' ? 'tag-archive' : 'tag-calc'">
              {{ result.valueSource }}
            </span>
          </td>
          <td>
            <span class="status-badge" :class="result.overLimit ? 'badge-warning' : 'badge-normal'">
              {{ result.section.status }}
            </span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="runAction('判定正常', result.section.code)">判定正常</button>
            <button class="link" type="button" @click="runAction('标记预警', result.section.code)">标记预警</button>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="11" class="empty-state">暂无符合条件的沉降监测成果</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filtered.length }} 条断面成果（页面口径，导出条数与此一致），合计累计沉降 {{ totalCumulative }} mm</span>
      <span v-if="lastExport" class="export-tip">上次导出 {{ lastExport.sectionCount }} 个断面 / {{ lastExport.observationCount }} 笔观测，校验码 {{ lastExport.checksum }}</span>
      <span v-if="message" class="info-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 处理说明 -->
    <section v-if="showNotes" class="notes-panel">
      <h3>沉降数据处理说明</h3>
      <ol class="rules-list">
        <li>统一口径：累计沉降量取「首次观测高程−最新观测高程」单次相减；沉降速率取最近两个不同观测日的区间速率（mm/d）。列表、详情、导出、待查台账、检修同步全部读同一份计算结果。</li>
        <li>同一断面只算一次：一个断面一条成果，观测次数再多也不叠加；同日上午/下午按次别 1/2 区分，同日变化不进速率。</li>
        <li>导出对齐页面：另存条数照页面口径（断面行数＝页面条数），文件按断面分组（断面成果段＋观测明细分组段＋提交受理段）；内容不含生成时间，重导字节一致，文件尾附校验码，对方可照这份核对。</li>
        <li>超限联动：标记预警或新观测导致超限时，自动同步到设施检修管理清单（一断面一待办，幂等更新），检修待办按最新累计沉降值降序重排；恢复正常自动关闭待办。</li>
        <li>存量回填：既有成果按监测日期回填观测、按验收日期归位排序；归档件给出权威值时以归档件为准，其余入口按它统一重算。</li>
        <li>并记拆分：早年把两次观测写成一条的，按并记顺序拆成两条（同日按上午/下午推定次别），拆分记录标注「并记拆分」并转待查台账核对原始记录本。</li>
        <li>缺项补项（自定）：缺高程按相邻两次有读数观测做线性内插（按日期天数比例），标注「内插补项」且转待查核实；若前后读数不足无法内插则保留缺项、不参与计算。缺监测人员补「未登记」并转待查。</li>
        <li>登记时间（自定）：既有条目按验收日期归位；早年没有登记时间的，取该断面最早一次动作日志的发生时间推定，依据标注「最早动作推定」。</li>
        <li>重复提交：以「断面＋监测日期＋高程」为同一笔指纹，只认第一次落库的那次，后面的整笔按重复退回（不写观测、不参与计算），受理记录与待查台账全程留痕。</li>
        <li>异常回写：超限预警、重复退回、并记拆分、缺项、取值争议全部回写待查台账，台账读数与页面同源；报表与明细清单的断面数、观测笔数在导出文件核对段显式对平。</li>
      </ol>
      <ul class="note-list">
        <li v-for="note in notes" :key="note.id">
          <span class="note-cat">{{ note.category }}</span>
          <strong>{{ note.sectionCode }}</strong>：{{ note.detail }}
        </li>
      </ul>
    </section>

    <!-- 详情面板 -->
    <div v-if="detailCode" class="modal-mask" @click.self="detailCode = ''">
      <div class="modal wide">
        <header class="modal-head">
          <h3>断面成果详情 · {{ detailCode }}</h3>
          <button class="link" type="button" @click="detailCode = ''">关闭</button>
        </header>
        <div v-if="detailResult" class="modal-body">
          <section class="detail-summary">
            <div><span>断面名称</span><strong>{{ detailResult.section.name }}</strong></div>
            <div><span>累计沉降量</span><strong :class="{ warning: detailResult.overLimit }">{{ detailResult.cumulativeMm }} mm</strong></div>
            <div><span>沉降速率</span><strong>{{ detailResult.rateMmPerDay === null ? '—' : `${detailResult.rateMmPerDay} mm/d` }}</strong></div>
            <div><span>速率区间</span><strong>{{ detailResult.rateFromDate ? `${detailResult.rateFromDate} ~ ${detailResult.rateToDate}` : '—' }}</strong></div>
            <div><span>预警阈值</span><strong>{{ detailResult.section.thresholdMm }} mm</strong></div>
            <div><span>取值来源</span><strong>{{ detailResult.valueSource }}</strong></div>
            <div><span>验收归位</span><strong>{{ detailResult.section.acceptedDate }}</strong></div>
            <div><span>登记时间</span><strong>{{ formatTime(detailResult.section.registeredAt) }}（{{ detailResult.section.registeredBasis }}）</strong></div>
          </section>

          <div v-if="detailArchive" class="archive-box">
            归档件裁定：《{{ detailArchive.title }}》（{{ detailArchive.docNo }}，{{ detailArchive.archiveDate }}）
            权威累计沉降量 <strong>{{ detailArchive.cumulativeMm }}mm</strong>。{{ detailArchive.note }}
          </div>

          <h4>观测明细（{{ detailObservations.length }} 笔，断面只取最新读数，不叠加）</h4>
          <table class="data-table inner-table">
            <thead>
              <tr><th>监测日期</th><th>次别</th><th>测点高程(m)</th><th>监测人员</th><th>来源</th><th>备注</th></tr>
            </thead>
            <tbody>
              <tr v-for="obs in detailObservations" :key="obs.id">
                <td>{{ obs.date }}</td>
                <td>第{{ obs.seq }}次</td>
                <td class="num">{{ obs.elevation }}</td>
                <td>{{ obs.operator }}</td>
                <td>{{ obs.source }}{{ obs.interpolated ? '(待核实)' : '' }}</td>
                <td>{{ obs.note ?? '—' }}</td>
              </tr>
            </tbody>
          </table>

          <h4>提交受理（重复提交只认第一次落库）</h4>
          <table class="data-table inner-table">
            <thead>
              <tr><th>提交时间</th><th>日期</th><th>高程(m)</th><th>结果</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="sub in detailSubmissions" :key="sub.id">
                <td>{{ formatTime(sub.submittedAt) }}</td>
                <td>{{ sub.date }}</td>
                <td class="num">{{ sub.elevation }}</td>
                <td :class="sub.outcome === 'accepted' ? 'ok-text' : 'error-text'">
                  {{ sub.outcome === 'accepted' ? '已落库（第一次）' : '整笔退回（重复）' }}
                </td>
                <td>{{ sub.message }}</td>
              </tr>
              <tr v-if="!detailSubmissions.length"><td colspan="5" class="empty-state">暂无提交受理记录</td></tr>
            </tbody>
          </table>

          <h4>动作日志</h4>
          <ul class="log-list">
            <li v-for="log in detailLogs" :key="log.id">
              {{ log.date }} · {{ log.action }} · {{ log.operator }}<template v-if="log.note"> · {{ log.note }}</template>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 提交观测 -->
    <div v-if="showIntake" class="modal-mask" @click.self="showIntake = false">
      <div class="modal">
        <header class="modal-head">
          <h3>提交沉降观测</h3>
          <button class="link" type="button" @click="showIntake = false">关闭</button>
        </header>
        <div class="modal-body">
          <p class="form-hint">同一断面、同一日期、相同高程视为同一笔：只认第一次落库，重复笔整笔退回。</p>
          <label class="form-row"><span>监测断面</span>
            <select v-model="intakeForm.sectionCode">
              <option v-for="section in sections" :key="section.code" :value="section.code">
                {{ section.code }} · {{ section.name }}
              </option>
            </select>
          </label>
          <label class="form-row"><span>监测日期</span><input v-model="intakeForm.date" type="date" /></label>
          <label class="form-row"><span>测点高程(m)</span><input v-model.number="intakeForm.elevation" type="number" step="0.001" placeholder="如 19.950" /></label>
          <label class="form-row"><span>监测人员</span><input v-model="intakeForm.operator" placeholder="监测人员姓名" /></label>
          <div class="modal-actions">
            <button class="btn primary" type="button" @click="submitIntake">提交</button>
            <button class="btn ghost" type="button" @click="showIntake = false">取消</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 登记监测点 -->
    <div v-if="showRegister" class="modal-mask" @click.self="showRegister = false">
      <div class="modal">
        <header class="modal-head">
          <h3>登记沉降监测点</h3>
          <button class="link" type="button" @click="showRegister = false">关闭</button>
        </header>
        <div class="modal-body">
          <label class="form-row"><span>监测断面编号</span><input v-model="registerForm.code" placeholder="如 DMI-05" /></label>
          <label class="form-row"><span>断面名称</span><input v-model="registerForm.name" placeholder="断面位置名称" /></label>
          <label class="form-row"><span>预警阈值(mm)</span><input v-model.number="registerForm.thresholdMm" type="number" step="1" /></label>
          <label class="form-row"><span>验收日期</span><input v-model="registerForm.acceptedDate" type="date" /></label>
          <div class="modal-actions">
            <button class="btn primary" type="button" @click="submitRegister">登记</button>
            <button class="btn ghost" type="button" @click="showRegister = false">取消</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  acceptObservation,
  actionLogsOf,
  archiveOf,
  changeSectionStatus,
  downloadCsv,
  exportSettlement,
  observationsOf,
  registerSection,
  settlementView,
  submissionsOf,
} from '@/settlement/service'
import type { CanonicalResult } from '@/settlement/types'

const statuses = ['待监测', '监测中', '沉降正常', '超限预警']

const results = ref<CanonicalResult[]>([])
const notes = ref(settlementView().notes)
const sections = ref(settlementView().sections)
const keyword = ref('')
const statusFilter = ref('')
const message = ref('')
const errorMessage = ref('')

const showNotes = ref(false)
const showIntake = ref(false)
const showRegister = ref(false)
const detailCode = ref('')
const lastExport = ref<{ sectionCount: number; observationCount: number; checksum: string } | null>(null)

const intakeForm = reactive({ sectionCode: '', date: '', elevation: null as number | null, operator: '' })
const registerForm = reactive({ code: '', name: '', thresholdMm: 20, acceptedDate: '' })

const filtered = computed(() =>
  results.value.filter((result) => {
    const hitKeyword =
      !keyword.value.trim() ||
      result.section.code.includes(keyword.value.trim()) ||
      result.section.name.includes(keyword.value.trim())
    const hitStatus = !statusFilter.value || result.section.status === statusFilter.value
    return hitKeyword && hitStatus
  }),
)

const stats = computed(() => [
  { label: '监测断面总数', value: results.value.length },
  { label: '超限预警断面', value: results.value.filter((r) => r.overLimit).length },
  { label: '沉降正常断面', value: results.value.filter((r) => r.section.status === '沉降正常').length },
  { label: '观测记录笔数', value: results.value.reduce((sum, r) => sum + r.observationCount, 0) },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: results.value.filter((row) => row.section.status === status).length,
  })),
)

const totalCumulative = computed(() =>
  Math.round(filtered.value.reduce((sum, r) => sum + r.cumulativeMm, 0) * 10) / 10,
)

const detailResult = computed(() => results.value.find((r) => r.section.code === detailCode.value) ?? null)
const detailObservations = computed(() => (detailCode.value ? observationsOf(detailCode.value) : []))
const detailSubmissions = computed(() => (detailCode.value ? submissionsOf(detailCode.value) : []))
const detailLogs = computed(() => (detailCode.value ? actionLogsOf(detailCode.value) : []))
const detailArchive = computed(() => (detailCode.value ? archiveOf(detailCode.value) : undefined))

function formatTime(stamp: string): string {
  if (!stamp) return '—'
  return stamp.length > 10 ? stamp.replace('T', ' ').slice(0, 16) : stamp
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
}

function reload() {
  errorMessage.value = ''
  message.value = ''
  const view = settlementView()
  results.value = view.results
  notes.value = view.notes
  sections.value = view.sections
}

function openDetail(code: string) {
  detailCode.value = code
}

function runAction(action: string, code: string) {
  const outcome = changeSectionStatus(code, action)
  if (!outcome.ok) {
    errorMessage.value = outcome.message
    return
  }
  message.value = outcome.message
  reload()
}

function submitIntake() {
  errorMessage.value = ''
  if (!intakeForm.sectionCode || !intakeForm.date || intakeForm.elevation === null) {
    errorMessage.value = '请补全断面、监测日期与测点高程'
    return
  }
  const outcome = acceptObservation({
    sectionCode: intakeForm.sectionCode,
    date: intakeForm.date,
    elevation: Number(intakeForm.elevation),
    operator: intakeForm.operator.trim(),
  })
  if (!outcome.ok) {
    // 重复笔整笔退回：提示留在页面上，同样不关闭弹窗，方便改日期/高程后重提
    errorMessage.value = outcome.message
  } else {
    message.value = outcome.message
    showIntake.value = false
  }
  reload()
}

function submitRegister() {
  errorMessage.value = ''
  if (!registerForm.code || !registerForm.name || !registerForm.acceptedDate) {
    errorMessage.value = '请补全断面编号、名称与验收日期'
    return
  }
  const outcome = registerSection({
    code: registerForm.code.trim(),
    name: registerForm.name.trim(),
    thresholdMm: Number(registerForm.thresholdMm) || 20,
    acceptedDate: registerForm.acceptedDate,
    operator: '当前值班',
  })
  if (!outcome.ok) {
    errorMessage.value = outcome.message
    return
  }
  message.value = outcome.message
  showRegister.value = false
  reload()
}

function exportRows() {
  const { filename, content, summary } = exportSettlement(filtered.value)
  downloadCsv(filename, content)
  lastExport.value = {
    sectionCount: summary.sectionCount,
    observationCount: summary.observationCount,
    checksum: content.trim().split('\n').pop() ?? '',
  }
  message.value = `已按断面分组导出 ${summary.sectionCount} 个断面成果；同条件重导内容与校验码一致。`
}

onMounted(reload)
</script>

<style scoped>
.settlement-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.settlement-table .strong {
  font-weight: 700;
}
.row-warning {
  background: #fff6f0;
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.badge-warning {
  background: #fde2d2;
  color: #b33a00;
}
.badge-normal {
  background: #e3f4e4;
  color: #1f7a33;
}
.source-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.tag-archive {
  background: #e7edff;
  color: #2a47b0;
}
.tag-calc {
  background: #eef1f4;
  color: #4a5568;
}
.export-tip {
  color: #2a47b0;
}
.info-text {
  color: #1f7a33;
}
.notes-panel {
  margin-top: 16px;
  border: 1px solid #d9e0ea;
  border-radius: 8px;
  padding: 16px 20px;
  background: #fafbfd;
}
.notes-panel h3 {
  margin: 0 0 8px;
}
.rules-list {
  margin: 0 0 12px;
  padding-left: 20px;
  color: #33415c;
  line-height: 1.7;
}
.note-list {
  margin: 0;
  padding-left: 18px;
  color: #4a5568;
  line-height: 1.7;
}
.note-cat {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 4px;
  background: #e7edff;
  color: #2a47b0;
  font-size: 12px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 5vh 16px;
  z-index: 50;
  overflow: auto;
}
.modal {
  width: 520px;
  max-width: 100%;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.25);
}
.modal.wide {
  width: 880px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid #e6ebf2;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.modal-body {
  padding: 16px 18px;
}
.detail-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px 16px;
  margin-bottom: 12px;
}
.detail-summary div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail-summary span {
  color: #7a869a;
  font-size: 12px;
}
.detail-summary strong.warning {
  color: #d4380d;
}
.archive-box {
  border: 1px solid #c7d4f7;
  background: #f2f5ff;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  line-height: 1.6;
  color: #2a47b0;
}
.modal-body h4 {
  margin: 14px 0 8px;
}
.inner-table {
  font-size: 13px;
}
.log-list {
  margin: 0;
  padding-left: 18px;
  color: #4a5568;
  line-height: 1.8;
}
.form-hint {
  margin: 0 0 12px;
  color: #7a869a;
  font-size: 13px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.form-row > span {
  width: 96px;
  color: #4a5568;
}
.form-row input,
.form-row select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #cfd8e3;
  border-radius: 6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.ok-text {
  color: #1f7a33;
}
</style>
