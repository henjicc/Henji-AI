// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { aiListTtsVoices } from '@/commands/aiRuntime'
import { VoiceSelectorPanel } from './VoiceSelectorPanel'

vi.mock('@/commands/aiRuntime', () => ({ aiListTtsVoices: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TTS voice selector', () => {
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
