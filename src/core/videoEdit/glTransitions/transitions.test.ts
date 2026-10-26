import { describe, expect, it } from 'vitest'
import { GL_TRANSITION_CATALOG } from './catalog.generated'
import { GL_TRANSITION_KINDS, GL_TRANSITION_PARAMS, GL_TRANSITION_PRESETS, glParamKey, glTransitionUniforms, isGlTransition, type GlTransitionKind } from './transitions'
import data from './zh.json'
import { VIDEO_EDIT_TRANSITION_PRESETS, videoEditTransitionSchema } from '../transitions'
import { normalizeVideoEditTransitionParams, resolveVideoEditTransitionParams, VIDEO_EDIT_BUILTIN_TRANSITION_KINDS } from '../transitionParams'
import { videoEditEffectsRegistry } from '../effectsRegistry'

const floats = (buffer: ArrayBuffer, offset: number, count: number): number[] => [...new Float32Array(buffer, offset, count)]
const ints = (buffer: ArrayBuffer, offset: number, count: number): number[] => [...new Int32Array(buffer, offset, count)]
const offset = (kind: GlTransitionKind, name: string): number => GL_TRANSITION_CATALOG.find(entry => `gl.${entry.name}` === kind)!.uniforms.find(uniform => uniform.name === name)!.offset

describe('gl-transitions 转场登记', () => {
  it('收录的转场全部进入过渡种类、效果面板与助手目录，名称不与已有过渡重名', () => {
    expect(GL_TRANSITION_KINDS.length).toBe(74)
    for (const kind of GL_TRANSITION_KINDS) {
      expect(isGlTransition(kind)).toBe(true)
      expect(VIDEO_EDIT_BUILTIN_TRANSITION_KINDS).toContain(kind)
    }
    const names = VIDEO_EDIT_TRANSITION_PRESETS.map(preset => preset.name)
    expect(new Set(names).size).toBe(names.length)
    const registry = videoEditEffectsRegistry().filter(entry => entry.transitionKind?.startsWith('gl.'))
    expect(registry).toHaveLength(74)
    expect(registry.every(entry => entry.group && entry.category === 'video_transition')).toBe(true)
    // 面板按分组连续排列：同一分组只出现一段。
    const groups = GL_TRANSITION_PRESETS.map(preset => preset.group)
    expect(groups.filter((group, index) => group !== groups[index - 1])).toEqual(Object.values(data.groups))
  })
  it('目录与 zh.json 一一对应，作者和许可齐全', () => {
    expect(GL_TRANSITION_CATALOG.map(entry => entry.name).sort()).toEqual(Object.keys(data.transitions).sort())
    for (const entry of GL_TRANSITION_CATALOG) {
      expect(entry.author.length, entry.name).toBeGreaterThan(0)
      expect(['MIT', 'BSD 2 Clause'], entry.name).toContain(entry.license)
      expect(Object.keys(data.excluded)).not.toContain(entry.name)
    }
  })
  it('参数键合法且不重复；默认值通过过渡参数校验，可写进文档', () => {
    for (const kind of GL_TRANSITION_KINDS) {
      const keys = GL_TRANSITION_PARAMS[kind].map(param => param.key)
      expect(new Set(keys).size, kind).toBe(keys.length)
      for (const key of keys) expect(key, kind).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
      const defaults = resolveVideoEditTransitionParams(kind, undefined)
      expect(() => normalizeVideoEditTransitionParams(kind, kind, defaults), kind).not.toThrow()
      expect(videoEditTransitionSchema.safeParse({ id: 't', kind, leftClipId: 'a', rightClipId: 'b', durationFrames: 30, parameters: defaults }).success, kind).toBe(true)
    }
    expect(glParamKey('FadeInSecond')).toBe('fade_in_second')
    expect(glParamKey('rectIn')).toBe('rect_in')
  })
  it('默认参数打包成上游 uniform 布局：进度、宽高比、颜色、选项、开关、位置', () => {
    const star = glTransitionUniforms('gl.StarWipe', resolveVideoEditTransitionParams('gl.StarWipe', undefined), 0.25, 16 / 9)
    expect(floats(star, 0, 2)).toEqual([0.25, Math.fround(16 / 9)])
    expect(floats(star, offset('gl.StarWipe', 'border_color'), 4)).toEqual([1, 1, 1, 1])
    expect(floats(star, offset('gl.StarWipe', 'star_center'), 2)).toEqual([0.5, 0.5])
    // 剪辑位置以左上角为原点，上游以左下角为原点：垂直百分比 0（上边缘）对应 uv.y = 1。
    const top = glTransitionUniforms('gl.StarWipe', { ...resolveVideoEditTransitionParams('gl.StarWipe', undefined), star_center_x: 25, star_center_y: 0 }, 0, 1)
    expect(floats(top, offset('gl.StarWipe', 'star_center'), 2)).toEqual([0.25, 1])
    const box = glTransitionUniforms('gl.Box', { rect_in: '0', location: '3' }, 1.5, 1)
    expect(floats(box, 0, 1)).toEqual([1])
    expect(ints(box, offset('gl.Box', 'rectIn'), 1)).toEqual([0])
    expect(ints(box, offset('gl.Box', 'location'), 1)).toEqual([3])
    const bounce = glTransitionUniforms('gl.Bounce', resolveVideoEditTransitionParams('gl.Bounce', undefined), 0, 1)
    expect(floats(bounce, offset('gl.Bounce', 'shadow_colour'), 4).map(value => Math.round(value * 255))).toEqual([0, 0, 0, 153])
    const tiles = glTransitionUniforms('gl.TilesWave', { tile_count_x: 3.4, tile_count_y: 5, flip_x: false }, 0, 1)
    expect(ints(tiles, offset('gl.TilesWave', 'tileCount'), 2)).toEqual([3, 5])
    expect(ints(tiles, offset('gl.TilesWave', 'flipX'), 1)).toEqual([0])
  })
})
