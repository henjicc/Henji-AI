import { expect, it, vi } from 'vitest'
import { LocalModelSessions } from './onnxRuntime'
it('动态识别会话跨批宽复用，线程配置参与键；固定形状与失败回退隔离', async () => {
  const release = vi.fn(async () => undefined), run = vi.fn(async () => ({}))
  const create = vi.fn(async () => ({ run, release }))
  const runtime = { InferenceSession: { create } } as unknown as typeof import('onnxruntime-node')
  const pool = new LocalModelSessions(runtime, () => undefined), model = { name: 'ppocr_rec' as const, path: 'rec.onnx' }
  const a = await pool.open(model, ['cpu'], 'dynamic', { intraOpNumThreads: 4 })
  for (let width = 128; width <= 1920; width += 128) {
    expect(await pool.open(model, ['cpu'], 'dynamic', { intraOpNumThreads: 4 })).toBe(a)
  }
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith('rec.onnx', expect.objectContaining({ enableMemPattern: false, intraOpNumThreads: 4, executionProviders: ['cpu'] }))
  expect(await pool.open(model, ['cpu'], 'dynamic', { intraOpNumThreads: 2 })).not.toBe(a)
  expect(await pool.open(model, ['cpu'], '128x48')).not.toBe(a)
  // 未指定线程数时不带这个键（原生绑定拒绝 undefined），跟踪、修补、音效分析都走这条。
  expect(Object.keys((create.mock.lastCall as unknown as [string, object])[1])).not.toContain('intraOpNumThreads')
  expect(await pool.open(model, ['cpu'], 'dynamic', { intraOpNumThreads: 4, allowSpinning: false })).not.toBe(a)
  expect(create).toHaveBeenLastCalledWith('rec.onnx', expect.objectContaining({ extra: { session: { intra_op: { allow_spinning: '0' } } } }))
  await pool.dispose(); expect(release).toHaveBeenCalledTimes(4)
})
