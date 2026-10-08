import { beforeEach, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock('@/services/database/DatabaseService', () => ({ databaseService: store }))
const record = { voiceId: 'sample', voiceName: '样本音色', providerId: 'kie', createdAt: '2026-10-09', updatedAt: '2026-10-09' }
beforeEach(() => { vi.resetModules(); store.getSetting.mockReset(); store.setSetting.mockReset().mockResolvedValue(undefined) })

it('当前版本音色可读，读取不改写原记录，明确保存时写版本外壳', async () => {
  store.getSetting.mockResolvedValue(JSON.stringify({ version: 1, content: [record] }))
  const { voiceLibraryService } = await import('./VoiceLibraryService')
  expect(await voiceLibraryService.listVoices()).toMatchObject([record])
  expect(store.setSetting).not.toHaveBeenCalled()
  await voiceLibraryService.upsertVoice({ ...record, voiceName: '已修改' })
  expect(JSON.parse(store.setSetting.mock.calls[0][1] as string)).toMatchObject({ version: 1, content: [{ voiceName: '已修改' }] })
})

it('旧开发期数组与损坏JSON不会被空音色库覆盖，重试仍检查权威记录', async () => {
  const { voiceLibraryService } = await import('./VoiceLibraryService')
  for (const raw of [JSON.stringify([record]), '{broken']) {
    store.getSetting.mockResolvedValue(raw)
    await expect(voiceLibraryService.listVoices()).rejects.toThrow()
    await expect(voiceLibraryService.upsertVoice(record)).rejects.toThrow()
    expect(store.setSetting).not.toHaveBeenCalled()
  }
})
