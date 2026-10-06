/**
 * 沉降领域对外门面：页面只从这里取数，保证列表 / 详情 / 导出 / 待查台账 / 检修清单
 * 读到的累计沉降量与沉降速率是同一份口径（computeAllCanonical）。
 */
import { computeAllCanonical } from './canonical'
import { buildSettlementCsv, exportSummary } from './export'
import {
  acceptObservation,
  changeSectionStatus,
  closeLedgerEntry,
  ensureSettlementReady,
  maintenanceRowsSorted,
  pendingMaintenanceCount,
  registerSection,
  resetSettlementDemo,
  syncOverLimitToMaintenance,
} from './store'
import type { IntakeInput } from './store'
import type {
  CanonicalResult,
  LedgerEntry,
  Observation,
  ProcessingNote,
  Section,
  SubmissionRecord,
} from './types'

export type { IntakeInput }

export function settlementView(): {
  results: CanonicalResult[]
  observations: Observation[]
  ledger: LedgerEntry[]
  notes: ProcessingNote[]
  submissions: SubmissionRecord[]
  sections: Section[]
} {
  const state = ensureSettlementReady()
  return {
    results: computeAllCanonical(state.sections, state.observations, state.archives),
    observations: state.observations,
    ledger: [...state.ledger].sort((a, b) => (a.foundAt < b.foundAt ? 1 : -1)),
    notes: [...state.notes].sort((a, b) => (a.date < b.date ? -1 : 1)),
    submissions: [...state.submissions].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1)),
    sections: state.sections,
  }
}

export function observationsOf(code: string): Observation[] {
  const state = ensureSettlementReady()
  return state.observations
    .filter((item) => item.sectionCode === code)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq))
}

export function submissionsOf(code: string): SubmissionRecord[] {
  const state = ensureSettlementReady()
  return state.submissions
    .filter((item) => item.sectionCode === code)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1))
}

export function actionLogsOf(code: string) {
  const state = ensureSettlementReady()
  return state.actionLogs
    .filter((item) => item.sectionCode === code)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
}

export function archiveOf(code: string) {
  const state = ensureSettlementReady()
  return state.archives.find((item) => item.sectionCode === code)
}

export function exportSettlement(
  filterResults?: CanonicalResult[],
): { filename: string; content: string; summary: ReturnType<typeof exportSummary> } {
  const state = ensureSettlementReady()
  const all = computeAllCanonical(state.sections, state.observations, state.archives)
  const codes = new Set((filterResults ?? all).map((item) => item.section.code))
  const results = all.filter((item) => codes.has(item.section.code))
  const file = buildSettlementCsv({ results, state })
  return { ...file, summary: exportSummary({ results, state }) }
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export {
  acceptObservation,
  changeSectionStatus,
  closeLedgerEntry,
  ensureSettlementReady,
  maintenanceRowsSorted,
  pendingMaintenanceCount,
  registerSection,
  resetSettlementDemo,
  syncOverLimitToMaintenance,
}
