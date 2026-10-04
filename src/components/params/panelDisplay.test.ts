import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/voiceLibrary/VoiceLibraryService', () => ({ voiceLibraryService: { getCachedVoiceName: () => undefined } }))
vi.mock('@/services/voiceLibrary/ttsVoiceNameCache', () => ({ getTtsVoiceName: () => undefined }))

import { formatPanelDisplayValue } from './panelDisplay'

describe('复合面板显示当前值而不是“点击设置”（任务 5.8，P-24）', () => {
  const defaults = { audioVol: 1, audioPitch: 0, format: 'mp3' }

  it('与默认值相同显示“默认”，改了几项显示“已调整 N 项”', () => {
    expect(formatPanelDisplayValue({ ...defaults }, 'composite', 'zh-CN', undefined, defaults)).toBe('默认')
    expect(formatPanelDisplayValue({ ...defaults, audioVol: 2, format: 'wav' }, 'composite', 'zh-CN', undefined, defaults)).toBe('已调整 2 项')
    expect(formatPanelDisplayValue(undefined, 'composite', 'zh-CN', undefined, defaults)).toBe('默认')
    expect(formatPanelDisplayValue({ ...defaults, audioVol: 2 }, 'composite', 'en-US', undefined, defaults)).toBe('1 changed')
  })

  it('音色克隆：没有克隆结果显示“未克隆”，克隆后显示音色名', () => {
    expect(formatPanelDisplayValue({ voiceName: '我的音色', lastPreviewAudioFilePath: '' }, 'minimax-voice-clone', 'zh-CN')).toBe('未克隆')
    expect(formatPanelDisplayValue({ voiceName: '我的音色', lastPreviewAudioFilePath: 'D:/a.mp3' }, 'minimax-voice-clone', 'zh-CN')).toBe('我的音色')
  })

  it('任何复合面板都不再出现行动号召“点击设置”', () => {
    for (const panel of ['composite', 'minimax-voice-clone']) {
      expect(formatPanelDisplayValue({ any: 1 }, panel, 'zh-CN')).not.toBe('点击设置')
    }
  })
})
