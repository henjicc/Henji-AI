// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { aiListTtsVoices } from '@/commands/aiRuntime'
import { VoiceSelectorPanel } from './VoiceSelectorPanel'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'

vi.mock('@/services/voiceLibrary/VoiceLibraryService', () => ({ voiceLibraryService: { listVoices: vi.fn(), subscribe: vi.fn(() => () => undefined), deleteVoice: vi.fn() } }))
vi.mock('@/core/services/GenerationService', () => ({ GenerationService: { getInstance: vi.fn() } }))
vi.mock('@/components/AudioPlayer', () => ({ default: () => null }))

vi.mock('@/commands/aiRuntime', () => ({ aiListTtsVoices: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TTS voice selector', () => {
  it('updates after training and disables unfinished or expired voices', async () => {
    const record = { providerId: 'speech', modelId: 'voice-model', voiceId: 'mine', voiceName: '待训练声音', createdAt: '', updatedAt: '', status: 'training' as const }
    vi.mocked(voiceLibraryService.listVoices).mockResolvedValue([record, { ...record, voiceId: 'bad', voiceName: '失败声音', status: 'failed' }, { ...record, voiceId: 'old', voiceName: '过期声音', status: 'ready', expiresAt: '2020-01-01' }])
    const changed = vi.fn()
    render(<VoiceSelectorPanel value="" onChange={changed} config={{ voices: [], voiceLibrary: { providerId: 'speech', modelId: 'voice-model' } }} />)
    const voice = await screen.findByRole('button', { name: /待训练声音/ })
    expect((voice as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /过期声音/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /失败声音/ }) as HTMLButtonElement).disabled).toBe(true)
    vi.mocked(voiceLibraryService.listVoices).mockResolvedValue([{ ...record, status: 'ready' }])
    await act(async () => { vi.mocked(voiceLibraryService.subscribe).mock.calls.at(-1)![0]() })
    fireEvent.click(screen.getByRole('button', { name: /待训练声音/ }))
    expect(changed).toHaveBeenCalledWith('mine')
  })
  it('loads account voices and chooses one without typing an ID', async () => {
    await i18n.changeLanguage('zh-CN')
    vi.mocked(aiListTtsVoices).mockResolvedValue([
      { id: 'cosyvoice-v3.5-flash-myvoice-123', name: '我的声音', source: 'clone' },
    ])
    const onChange = vi.fn()
    render(<VoiceSelectorPanel value="" onChange={onChange} config={{
      voices: [],
      allowCustomId: true,
      remoteModelId: 'bailian-cosyvoice-v3.5',
    }} />)

    expect(await screen.findByText('我的声音')).toBeTruthy()
    expect(aiListTtsVoices).toHaveBeenCalledWith('bailian-cosyvoice-v3.5')
    expect(screen.queryByPlaceholderText('输入列表中没有的音色 ID')).toBeNull()
    fireEvent.click(screen.getByText('我的声音'))
    expect(onChange).toHaveBeenCalledWith('cosyvoice-v3.5-flash-myvoice-123')
  })
})
