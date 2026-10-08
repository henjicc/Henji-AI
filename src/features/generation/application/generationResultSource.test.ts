import { expect, it, vi } from 'vitest'
const history = vi.hoisted(() => vi.fn())
vi.mock('@/services/database', () => ({ databaseService: { getHistoryById: history } }))
vi.mock('@/commands/image', () => ({ readImageInfo: vi.fn(async () => ({ fileName: 'result.png' })) }))
import { readGenerationResultMedia } from './generationResultSource'

it.each(['image', 'video', 'audio'])('%s 选择结果和默认结果都生成短名，原提示词完整保留', async type => {
  const prompt = `你好😀e\u0301${'夜景海报'.repeat(120)}`
  const record = { id: 'record', type, status: 'success', resultPaths: ['D:/generated/result.png'], params: {}, prompt }
  history.mockResolvedValue(record)
  const selected = await readGenerationResultMedia('record', undefined, { outputIndex: 0, localOnly: true })
  expect(selected).toMatchObject({ prompt, mediaType: type, source: record.resultPaths[0] })
  expect(selected!.name.length).toBeLessThanOrEqual(80)
  expect(await readGenerationResultMedia('record')).toEqual(selected)
  expect(record.prompt).toBe(prompt)
})
