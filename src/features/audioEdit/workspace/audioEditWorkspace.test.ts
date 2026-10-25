import { describe, expect, it } from 'vitest'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { audioEditHistoryEntries, describeAudioEditStep } from './audioEditHistory'
import { markAgentAuthoredStep } from '@/features/application-control/agentEditing'
import { AUDIO_EDIT_LAYOUT_PRESETS, AUDIO_EDIT_PANELS, parseAudioEditLayout } from './audioEditDockLayout'

const base: AudioEditProjectDocument = {
  id: 'history', name: '音频', referenceScript: '', suggestions: [], vstEnabled: false,
  source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', durationFrames: 480000, sampleRate: 48000, channels: 1 },
  transcript: [], createdAt: 1, updatedAt: 1, revision: 1,
}

describe('音频编辑历史记录', () => {
  it('按相邻快照说出这一步改了什么', () => {
    const muted = { ...base, cuts: [{ id: 'c', startFrame: 0, endFrame: 100, mode: 'mute' as const, enabled: true, reason: 'manual' as const }] }
    expect(describeAudioEditStep(base, muted)).toBe('静音')
    expect(describeAudioEditStep(muted, { ...muted, cuts: [] })).toBe('恢复')
    const faded = { ...base, gainRegions: [{ id: 'g', startFrame: 0, endFrame: 100, gainDb: 0, fadeInFrames: 100, fadeOutFrames: 0, enabled: true }] }
    expect(describeAudioEditStep(base, faded)).toBe('淡入')
    expect(describeAudioEditStep(base, { ...base, name: '新名字' })).toBe('重命名')
  })

  it('当前之前的步骤可撤销、之后的可重做，点哪步就走几步', () => {
    const one = { ...base, name: '一' }, two = { ...one, name: '二' }, three = { ...two, name: '三' }
    const entries = audioEditHistoryEntries([base, one], two, [three])
    expect(entries.map(entry => [entry.label, entry.state, entry.steps])).toEqual([
      ['起点', 'done', 2], ['重命名', 'done', 1], ['重命名', 'current', 0], ['重命名', 'undone', -1],
    ])
  })

  it('助手做的步骤在名字前标出“助手”，撤销时知道撤的是谁的', () => {
    const byAgent = { ...base, name: '助手改' }
    markAgentAuthoredStep(byAgent)
    expect(audioEditHistoryEntries([base], byAgent, []).map(entry => entry.label)).toEqual(['起点', '助手：重命名'])
  })
})

describe('音频编辑布局预设', () => {
  it('每个内置预设都包含全部面板且各出现一次', () => {
    for (const preset of AUDIO_EDIT_LAYOUT_PRESETS) {
      const layout = parseAudioEditLayout(JSON.stringify(preset.layout()))
      expect(Object.keys(layout.panels).sort()).toEqual(AUDIO_EDIT_PANELS.map(panel => panel.id).sort())
    }
  })

  it('拒绝未知面板和重复面板，旧面板名以当前定义为准', () => {
    const layout = AUDIO_EDIT_LAYOUT_PRESETS[0].layout()
    expect(() => parseAudioEditLayout(JSON.stringify({ ...layout, panels: { ...layout.panels, unknown: { id: 'unknown', contentComponent: 'unknown' } } }))).toThrow()
    const renamed = JSON.parse(JSON.stringify(layout))
    renamed.panels.editor.title = '旧名字'
    expect(parseAudioEditLayout(JSON.stringify(renamed)).panels.editor.title).toBe('编辑器')
  })
})
