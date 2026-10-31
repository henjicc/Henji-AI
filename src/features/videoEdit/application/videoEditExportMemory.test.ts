import { expect, it } from 'vitest'
import { VideoEditExportMemory, VIDEO_EDIT_EXPORT_MEMORY_KEY } from './videoEditExportMemory'
import { VIDEO_EDIT_EXPORT_PRESETS } from '@/core/videoEdit/exportPresets'

it('按项目和序列只在明确记忆时保存完整快照，读取不写盘，损坏内容不能被覆盖', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string): string | null => values.get(key) ?? null, setItem: (key: string, value: string): void => { values.set(key, value) } }
  const memory = new VideoEditExportMemory(storage)
  const entry = { projectId: 'p', sequenceId: 's', presetId: 'builtin:sequence', settings: VIDEO_EDIT_EXPORT_PRESETS[0].settings, directory: '/exports', fileName: '成片.mp4', range: { startFrame: 30, endFrame: 330 }, rangeSource: 'explicit' as const, completedAt: 1 }
  memory.remember(entry); memory.remember({ ...entry, sequenceId: 's2', loudnessRequested: true }); memory.remember({ ...entry, projectId: 'p2' }); memory.remember({ ...entry, fileName: '新版.mp4', loudnessRequested: false })
  const saved = values.get(VIDEO_EDIT_EXPORT_MEMORY_KEY)
  const restored = new VideoEditExportMemory(storage)
  expect(restored.read('p', 's')?.fileName).toBe('新版.mp4')
  expect(restored.read('p', 's')?.loudnessRequested).toBe(false)
  expect(restored.read('p', 's2')?.loudnessRequested).toBe(true)
  expect(restored.read('p2', 's')?.loudnessRequested).toBeUndefined()
  expect(restored.read('p', 's2')?.fileName).toBe('成片.mp4')
  expect(restored.read('p2', 's')?.range).toEqual(entry.range)
  expect(values.get(VIDEO_EDIT_EXPORT_MEMORY_KEY)).toBe(saved)
  values.set(VIDEO_EDIT_EXPORT_MEMORY_KEY, '{')
  const broken = new VideoEditExportMemory(storage)
  expect(() => broken.remember(entry)).toThrow()
  expect(values.get(VIDEO_EDIT_EXPORT_MEMORY_KEY)).toBe('{')
})
it('前向未知字段随项目和序列对齐，插入和重排不会串到另一条记忆', () => {
  const entry = { projectId: 'p', sequenceId: 's', presetId: 'builtin:sequence', settings: VIDEO_EDIT_EXPORT_PRESETS[0].settings, directory: '/exports', fileName: '成片.mp4', range: { startFrame: 0, endFrame: 10 }, rangeSource: 'content' as const, completedAt: 1 }
  let text = JSON.stringify({ version: 4, minReaderVersion: 1, content: [{ ...entry, future: 'first' }, { ...entry, projectId: 'p2', future: 'second' }] })
  const memory = new VideoEditExportMemory({ getItem: () => text, setItem: (_key, value) => { text = value } })
  memory.remember({ ...entry, sequenceId: 'inserted' })
  memory.remember({ ...entry, projectId: 'p2', fileName: '重存.mp4' })
  const saved = JSON.parse(text) as { version: number; content: Array<typeof entry & { future?: string }> }
  expect(saved.version).toBe(4)
  expect(saved.content.find(value => value.projectId === 'p2')?.future).toBe('second')
  expect(saved.content.find(value => value.projectId === 'p' && value.sequenceId === 's')?.future).toBe('first')
  expect(saved.content.find(value => value.sequenceId === 'inserted')?.future).toBeUndefined()
})
