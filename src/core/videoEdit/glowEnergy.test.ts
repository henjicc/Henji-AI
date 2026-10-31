import { expect, it, vi } from 'vitest'
import { normalizeVideoEditBuiltinParams } from './builtinEffects'
import { glowEnergySupport } from './glowEnergy'

it('外扩按参数值、内容尺寸、参考高度与质量跨帧复用，变更失效并有界逐出', () => {
  const params = normalizeVideoEditBuiltinParams('glow', { radius: 1, resolution: 25 })
  const exp = vi.spyOn(Math, 'exp')
  try {
    const initial = glowEnergySupport(params, 3, 4, 20, 'final')
    expect(exp).toHaveBeenCalled()
    exp.mockClear()
    for (let frame = 0; frame < 60; frame++) expect(glowEnergySupport({ ...params }, 3, 4, 20, 'final')).toBe(initial)
    expect(exp).not.toHaveBeenCalled()
    for (const [p, w, h, ref, quality] of [
      [{ ...params, radius: 2 }, 3, 4, 20, 'final'], [params, 4, 4, 20, 'final'],
      [params, 3, 5, 20, 'final'], [params, 3, 4, 21, 'final'], [params, 3, 4, 20, 'interactive'],
    ] as const) {
      exp.mockClear(); glowEnergySupport(p, w, h, ref, quality); expect(exp).toHaveBeenCalled()
    }
    for (let index = 0; index < 129; index++) glowEnergySupport({ ...params, strength: index / 10 }, 3, 4, 20, 'final')
    exp.mockClear(); expect(glowEnergySupport(params, 3, 4, 20, 'final')).toBe(initial); expect(exp).toHaveBeenCalled()
  } finally { exp.mockRestore() }
})

it.runIf(process.env.HENJI_TEST_PERFORMANCE === '1')('静止发光层缓存命中后单层外扩低于 0.2ms', () => {
  const cases = [{}, { aspect: 100 }, { radius: 100, resolution: 100 }]
  for (const overrides of cases) {
    const params = normalizeVideoEditBuiltinParams('glow', overrides)
    const coldStart = performance.now()
    const support = glowEnergySupport(params, 800, 200, 1080, 'final')
    const coldMs = performance.now() - coldStart
    const samples: number[] = []
    for (let batch = 0; batch < 30; batch++) {
      const start = performance.now()
      for (let frame = 0; frame < 100; frame++) glowEnergySupport({ ...params }, 800, 200, 1080, 'final')
      samples.push((performance.now() - start) / 100)
    }
    const p95 = samples.sort((a, b) => a - b)[28]
    process.stdout.write(`glowEnergySupport ${JSON.stringify({ overrides, coldMs, hitP95Ms: p95, support })}\n`)
    expect(p95).toBeLessThan(.2)
  }
})
