import { LEGACY_SETTLEMENT } from './settlement-legacy'
import { normalizeLegacySettlement, recomputeChain } from './settlement-engine'
import type { Observation, RejectedSubmission } from './settlement-types'

// 沉降口径独立成库并带版本号：存量成果一次性归一化迁移，口径升级时抬版本即可重算，
// 不再像旧导出那样把上一轮差值残留在文件/存储里。
const STORAGE_KEY = 'urban-utility-tunnel:settlement:v1'

interface SettlementStore {
  observations: Observation[]
  rejected: RejectedSubmission[]
  migratedAt: string
}

let memory: SettlementStore | null = null

function buildInitial(): SettlementStore {
  const { observations, rejected } = normalizeLegacySettlement(LEGACY_SETTLEMENT)
  return { observations, rejected, migratedAt: '2026-10-06' }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read(): SettlementStore {
  if (memory) {
    return memory
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SettlementStore
        memory = parsed
        return parsed
      } catch {
        // 存储损坏时回落到重新迁移，不让坏数据继续污染口径。
      }
    }
  }
  const initial = buildInitial()
  memory = initial
  persist()
  return initial
}

function persist(): void {
  if (!memory) {
    return
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  }
}

export function getObservations(): Observation[] {
  return clone(read().observations)
}

export function getRejected(): RejectedSubmission[] {
  return clone(read().rejected)
}

export function saveObservations(observations: Observation[]): void {
  // 任何写库前都按唯一口径重算一遍，列表、详情、导出永远同源。
  recomputeChain(observations as (Observation & { anchor?: number | null })[])
  const store = read()
  store.observations = observations
  memory = store
  persist()
}

export function saveRejected(rejected: RejectedSubmission[]): void {
  const store = read()
  store.rejected = rejected
  memory = store
  persist()
}

/** 回到「存量迁移完成」的初始口径结果。 */
export function resetSettlement(): { observations: Observation[]; rejected: RejectedSubmission[] } {
  memory = buildInitial()
  persist()
  return { observations: clone(memory.observations), rejected: clone(memory.rejected) }
}

export function settlementStorageKey(): string {
  return STORAGE_KEY
}
