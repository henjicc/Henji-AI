import { vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { handleUiPaidApproval } from '../../electron/main/services/application-runtime/paidApprovalPolicy'
import type { OperationRecord } from '../../electron/main/services/application-runtime/operationStore'
import { DEFAULT_PAID_APPROVAL_SETTINGS, generationReservationKey, type PaidApprovalSettings } from '@/core/application-control/paidApproval'

const settings = vi.hoisted(() => ({ value: '' }))
vi.mock('../../electron/main/services/settings/store', () => ({ getSettingsStore: () => ({
  get: () => settings.value, set: (_key: string, value: string) => { settings.value = value },
}) }))
vi.mock('../../electron/main/services/logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

/** Real approval policy and state machine, with only the IPC/storage boundary replaced. */
export function installPaidApprovalTestBridge(initial: Partial<PaidApprovalSettings> = { unlimited: true }) {
  const records = new Map<string, OperationRecord>()
  const reserved = (since: number, counts: (record: OperationRecord) => boolean): number => {
    const seen = new Set<string>()
    return [...records.values()].filter(record => record.state !== 'not_executed' && counts(record))
      .reduce((sum, record) => sum + (record.paidReservations ?? []).reduce((total, reservation) => {
        if (reservation.reservedAt < since) return total
        const key = generationReservationKey(reservation)
        if (key && seen.has(key)) return total
        if (key) seen.add(key)
        return total + (reservation.estimatedCny ?? 0)
      }, 0), 0)
  }
  const store = {
    get: (id: string) => records.get(id),
    save: (record: OperationRecord) => { records.set(record.operationId, record) },
    prepare: (record: OperationRecord) => { records.set(record.operationId, record); return record },
    generationTaskReservations: () => [...records.values()].filter(record => record.state !== 'not_executed')
      .flatMap(record => (record.paidReservations ?? []).filter(item => generationReservationKey(item))),
    generationSpendSince: (since: number) => reserved(since, record => record.origin?.actor !== 'user'),
  }
  const setSettings = (value: Partial<PaidApprovalSettings>): void => { settings.value = JSON.stringify({ ...DEFAULT_PAID_APPROVAL_SETTINGS, ...initial, ...value }) }
  setSettings({})
  const complete = vi.spyOn(getPlatform().applicationControl, 'complete').mockImplementation(async reply => {
    if (!reply.uiPaidApproval) throw new Error('测试桥仅处理付费授权')
    return handleUiPaidApproval(store, reply)
  })
  // 界面操作不占每日额度，但预留仍要去重；验证预留复用时看全部来源。
  const reservedCny = (): number => reserved(0, () => true)
  return { records, complete, store, setSettings, reservedCny }
}
