// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { emptyMemorySnapshot, type MemorySnapshot } from '@/core/assistant/memoryEntries'
import { rememberedFont } from './memoryDefaults'
import { getVideoEditSequenceDefaults } from '@/features/videoEdit/application/videoEditSequenceDefaults'
const data = vi.hoisted(() => ({ memory: undefined as MemorySnapshot | undefined }))
vi.mock('./memoryState', () => ({ cachedMemory: () => data.memory, refreshMemory: vi.fn(), subscribeMemory: vi.fn() }))
vi.mock('@/features/documents', () => ({ currentDocumentContext: () => ({}), getDocumentSessionRegistry: () => ({ get: () => undefined }) }))
vi.mock('@/platform/fonts', () => ({ resolveFont: (name: string) => ['思源黑体', 'Arial', '宋体'].includes(name) ? { family: name } : undefined, fontLibrarySnapshot: vi.fn(), loadFontLibrary: vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ videoEditSequenceDefaults: { width: 1920, height: 1080, frameRate: 30 } }) } }))
beforeEach(() => { data.memory = emptyMemorySnapshot(); data.memory.entries = [
  { id: 'zh', section: 'creative', source: 'user', content: '中文用思源黑体。', value: { key: 'font.zh', fonts: ['没有安装', '思源黑体'] }, revision: 1, updatedAt: '2026-10-23T00:00:00Z' },
  { id: 'latin', section: 'creative', source: 'user', content: '英文用 Arial。', value: { key: 'font.latin', fonts: ['Arial'] }, revision: 1, updatedAt: '2026-10-23T00:00:00Z' },
  { id: 'aspect', section: 'creative', source: 'user', content: '新序列用竖屏。', value: { key: 'aspect', width: 9, height: 16 }, revision: 1, updatedAt: '2026-10-23T00:00:00Z' },
] })
it('新文字按语言取首个本机可用字体，风格字体与显式偏好遵循同一优先级', () => {
  expect(rememberedFont('中文')).toBe('思源黑体')
  expect(rememberedFont('English')).toBe('Arial')
  expect(rememberedFont('中文', undefined, '宋体')).toBe('宋体')
  data.memory!.entries[0].precedence = 'preference'
  expect(rememberedFont('中文', undefined, '宋体')).toBe('思源黑体')
})
it('新序列默认画幅取记忆，关闭后字体与序列均回到原默认', () => {
  expect(getVideoEditSequenceDefaults()).toMatchObject({ width: 608, height: 1080 })
  data.memory!.settings.enabled = false
  expect(rememberedFont('中文')).toBeUndefined()
  expect(getVideoEditSequenceDefaults()).toMatchObject({ width: 1920, height: 1080 })
})
