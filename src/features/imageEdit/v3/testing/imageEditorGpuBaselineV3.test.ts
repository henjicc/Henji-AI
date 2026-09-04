import { describe, expect, it } from 'vitest'

import {
  compareImageEditorGoldenV3,
  createImageEditorGpuBaselineFixturesV3,
  fingerprintImageEditorGoldenV3,
  renderImageEditorCpuGoldenV3,
} from './imageEditorGpuBaselineV3'

describe('图片编辑 GPU 迁移基准与 CPU 真值', () => {
  it('固定五层、16 层、复杂蒙版、HDR 与 8192 场景契约', () => {
    const fixtures = createImageEditorGpuBaselineFixturesV3()
    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      'kie-five-layer', 'sixteen-layer', 'complex-mask', 'hdr-rec2020', 'large-8192',
    ])
    expect(fixtures[0].document.layers).toHaveLength(5)
    expect(fixtures[1].document.layers).toHaveLength(16)
    expect(fixtures[2].document.layers.some((layer) => layer.type === 'group')).toBe(true)
    expect(fixtures[2].document.layers.some((layer) => layer.type === 'adjustment')).toBe(true)
    expect(fixtures[3].document.color).toMatchObject({
      workingSpace: 'rec2020', bitDepth: 'float16', transferFunction: 'pq',
    })
    expect(fixtures[4].document.geometry).toMatchObject({ width: 8_192, height: 8_192 })
  })

  it('相同输入得到稳定 CPU golden 指纹', async () => {
    for (const fixture of createImageEditorGpuBaselineFixturesV3().slice(0, 4)) {
      const first = await renderImageEditorCpuGoldenV3(fixture)
      const second = await renderImageEditorCpuGoldenV3(fixture)
      expect(fingerprintImageEditorGoldenV3(first.data)).toBe(
        fingerprintImageEditorGoldenV3(second.data),
      )
      expect(compareImageEditorGoldenV3(first.data, second.data)).toMatchObject({
        linearWithinTolerance: true,
        quantizedWithinOneLsbRatio: 1,
        quantizedMaxLsbError: 0,
      })
    }
  })

  it('按线性误差与 8-bit LSB 双重门槛报告偏差', () => {
    const reference = Float32Array.from([0, 0.25, 0.5, 1])
    const candidate = Float32Array.from([0, 0.25005, 0.504, 1])
    const comparison = compareImageEditorGoldenV3(reference, candidate)
    expect(comparison.linearWithinTolerance).toBe(false)
    expect(comparison.quantizedWithinOneLsbRatio).toBe(1)
    expect(comparison.quantizedMaxLsbError).toBe(1)
  })
})
