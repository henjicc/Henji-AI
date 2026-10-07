import { describe, expect, it, vi } from 'vitest'
import { SHADER_EFFECT_DEFINITIONS } from '../../../../core/videoEdit/shaderLibrary/catalog'
import { normalizeVideoEditBuiltinParams } from '../../../../core/videoEdit/builtinEffects'
import { planVideoEditBuiltinEffect } from '../videoEditBuiltinEffectPasses'
import { TrustedShaderLibraryRenderer } from './render'
import { planShaderLibraryEffect } from './planner'
import type { GpuTexture } from '../../../../core/imageEdit/worker/webgpuRuntimeSupport'

describe('着色器工序与可信接口', () => {
  it('每个参数边界规划有限值且强度0精确复制；绘制时间不依赖帧号或墙钟', () => {
    for (const definition of SHADER_EFFECT_DEFINITIONS) {
      for (const bound of ['min', 'max'] as const) {
        const params = normalizeVideoEditBuiltinParams(definition.id, Object.fromEntries(definition.params.map(param => [param.key, param.type === 'number' ? param[bound] : param.default])))
        const plan = planVideoEditBuiltinEffect({ id: definition.id, params, shaderTimeSeconds: 1.25 }, { width: 3840, height: 2160, frame: 75 })
        expect(plan.passes.every(pass => pass.uniforms.every(Number.isFinite))).toBe(true)
      }
      const params = normalizeVideoEditBuiltinParams(definition.id, { strength: 0 })
      expect(planVideoEditBuiltinEffect({ id: definition.id, params }, { width: 3840, height: 2160, frame: 30 }).passes.map(pass => pass.entry)).toEqual(['copy'])
    }
    const instance = { id: 'shader_wave', params: normalizeVideoEditBuiltinParams('shader_wave'), shaderTimeSeconds: 1 }
    expect(planVideoEditBuiltinEffect(instance, { width: 64, height: 36, frame: 24 })).toEqual(planVideoEditBuiltinEffect(instance, { width: 64, height: 36, frame: 60 }))
    expect(() => planShaderLibraryEffect({ ...instance, shaderTimeSeconds: NaN }, 64, 36)).toThrow('秒数')
  })
  it('按名称渲染只委托注入宿主；拒绝未知名称、WGSL、错误时间、输入输出别名和错误转场', async () => {
    const host = { render: vi.fn<Parameters<import('../videoEditBuiltinEffectsGpu').VideoEditBuiltinEffectsGpu['render']>, Promise<void>>(async () => {}), renderTransition: vi.fn<Parameters<import('../videoEditBuiltinEffectsGpu').VideoEditBuiltinEffectsGpu['renderTransition']>, Promise<void>>(async () => {}) }
    const runtime = new TrustedShaderLibraryRenderer(host)
    const input: GpuTexture = { createView: () => ({}), destroy: () => {} }
    const output: GpuTexture = { createView: () => ({}), destroy: () => {} }
    const request = { name: 'shader_wave', timeSeconds: 1.5, width: 1920, height: 1080, format: 'rgba8unorm', input, output }
    await runtime.render(request)
    expect(host.render.mock.calls[0][0]).toMatchObject({ shaderTimeSeconds: 1.5 })
    await expect(runtime.render({ ...request, name: '@fragment fn' })).rejects.toThrow('没有登记')
    await expect(runtime.render({ ...request, params: { wgsl: 'x' } })).rejects.toThrow('没有参数')
    await expect(runtime.render({ ...request, timeSeconds: NaN })).rejects.toThrow('秒时间')
    await expect(runtime.render({ ...request, output: input })).rejects.toThrow('同一纹理')
    await expect(runtime.render({ ...request, name: 'shader_noise_dissolve' })).rejects.toThrow('前后两幅')
    await expect(runtime.render({ ...request, name: 'shader_noise_dissolve', second: input, progress: 2 })).rejects.toThrow('0 到 1')
    expect(host.render).toHaveBeenCalledTimes(1)
  })
})
