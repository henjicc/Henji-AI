import { beforeEach, expect, it, vi } from 'vitest'
import { EXTERNAL_CONTENT_CODE_SETTING_KEY } from '../../../../src/core/contentTrust'
import { PAID_APPROVAL_SETTING_KEY, paidApprovalSettingsSchema } from '../../../../src/core/application-control/paidApproval'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('../settings/store', () => ({ getSettingsStore: () => ({ get: (key: string) => storage.get(key), set: (key: string, value: string) => storage.set(key, value) }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info() {} }) }))
beforeEach(() => { vi.resetModules(); storage.clear() })

it('总开关独立落盘，进程重建仍有效，付费记录保持旧版严格 schema 可读', async () => {
  const paid = JSON.stringify(paidApprovalSettingsSchema.parse({ singleLimitCny: 3 }))
  storage.set(PAID_APPROVAL_SETTING_KEY, paid)
  const { contentTrust } = await import('./runtime')
  expect(contentTrust().policy()).toBe(false)
  contentTrust().setPolicy(true)
  expect(storage.get(EXTERNAL_CONTENT_CODE_SETTING_KEY)).toBe('true')
  expect(storage.get(PAID_APPROVAL_SETTING_KEY)).toBe(paid)
  expect(() => paidApprovalSettingsSchema.parse(JSON.parse(storage.get(PAID_APPROVAL_SETTING_KEY)!))).not.toThrow()
  vi.resetModules()
  expect((await import('./runtime')).contentTrust().policy()).toBe(true)
})
