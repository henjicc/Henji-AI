import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ init: vi.fn(), getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock('@/services/database/DatabaseService', () => ({ databaseService: db }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); db.getSetting.mockResolvedValue(null); db.setSetting.mockResolvedValue(undefined) })

describe('cloned voice persistence', () => {
  it('keeps concurrent voices, recovers training, preserves preview and removes expiry on activation', async () => {
    const { captureClonedVoice } = await import('./captureClonedVoice')
    const { voiceLibraryService } = await import('./VoiceLibraryService')
    const changed = vi.fn()
    const stop = voiceLibraryService.subscribe(changed)
    await Promise.all(['a', 'b'].map(id => captureClonedVoice('model', 'speech', { status: 'pending', taskId: id, metadata: {
      clonedVoice: { id, name: id, status: 'training', postpaid: true, createdAt: 1700000000000 },
    } })))
    expect(await voiceLibraryService.listVoices()).toHaveLength(2)
    await captureClonedVoice('model', 'speech', { status: 'completed', filePaths: ['C:/voice.mp3'], metadata: {
      clonedVoice: { id: 'a', name: 'a', status: 'ready', postpaid: true, createdAt: 1700000000000 },
    } })
    expect((await voiceLibraryService.listVoices()).find(item => item.voiceId === 'a')).toMatchObject({ status: 'ready', previewPath: 'C:/voice.mp3', taskId: 'a', expiresAt: expect.any(String) })
    await captureClonedVoice('model', 'speech', { status: 'completed', metadata: { activatedVoiceId: 'a' } })
    expect((await voiceLibraryService.listVoices()).find(item => item.voiceId === 'a')).toMatchObject({ activated: true, expiresAt: undefined })
    await Promise.all([voiceLibraryService.upsertVoice({ providerId: 'other', voiceId: 'a', voiceName: 'other' }), voiceLibraryService.deleteVoice('a', { providerId: 'speech' })])
    expect((await voiceLibraryService.listVoices()).map(item => [item.providerId, item.voiceId])).toEqual(expect.arrayContaining([['other', 'a'], ['speech', 'b']]))
    expect(changed).toHaveBeenCalledTimes(6)
    stop()
  })

  it('reports storage failures and permits retry without poisoning later writes', async () => {
    const { voiceLibraryService } = await import('./VoiceLibraryService')
    db.setSetting.mockRejectedValueOnce(new Error('disk full'))
    const voice = { providerId: 'speech', voiceId: 'a', voiceName: 'a' }
    await expect(voiceLibraryService.upsertVoice(voice)).rejects.toThrow('disk full')
    expect(await voiceLibraryService.listVoices()).toHaveLength(0)
    await voiceLibraryService.upsertVoice(voice)
    expect(await voiceLibraryService.listVoices()).toHaveLength(1)
  })

  it('marks only the failed training task and can recover on a later successful query', async () => {
    const { voiceLibraryService } = await import('./VoiceLibraryService')
    await voiceLibraryService.upsertVoice({ providerId: 'speech', voiceId: 'a', voiceName: 'a', taskId: 'task-a', status: 'training' })
    await voiceLibraryService.upsertVoice({ providerId: 'speech', voiceId: 'b', voiceName: 'b', taskId: 'task-b', status: 'training' })
    await voiceLibraryService.markTaskFailed('task-a')
    expect((await voiceLibraryService.listVoices()).map(v => [v.voiceId, v.status])).toEqual(expect.arrayContaining([['a', 'failed'], ['b', 'training']]))
    await voiceLibraryService.upsertVoice({ providerId: 'speech', voiceId: 'a', voiceName: 'a', status: 'ready' })
    expect((await voiceLibraryService.listVoices()).find(v => v.voiceId === 'a')?.status).toBe('ready')
  })
})
