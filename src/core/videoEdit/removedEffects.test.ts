import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocumentText } from '../documents/envelope'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '../persistence/schemaVersions'
import { PERSISTENCE_FORMATS } from '../persistence/formats'
import { upgradePersistenceContent } from '../persistence/migrations'
import { videoEditDocumentSchema } from './document'
import { activeVideoEditEffects } from './compositing'
import { evaluateVideoEditClip, sliceVideoEditBuiltinCurves } from './keyframes'
import { isRemovedVideoEditBuiltinEffect, normalizeVideoEditBuiltinParams, resolveVideoEditBuiltinParams, storedVideoEditBuiltinEffectNotes } from './builtinEffects'
import { audioEditEffectChainSchema, audioEditChainItemEffects } from '../audioEdit/effects'

const fixture = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v47.json', 'utf8'))
const content = upgradePersistenceContent(PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!, fixture.content, fixture.kindVersion) as { sequences: Array<{ clips: Array<{ id: string; effects?: unknown[] }> }> }
const removed = { id: 'removed', name: '亮度与对比度', enabled: true, amount: 1, builtin: { id: 'brightness_contrast', params: { brightness: -35 }, curves: { brightness: [{ time: 0, value: -35, interpolation: 'linear' as const }, { time: 10, value: 20, interpolation: 'linear' as const }] } } }
const shader = { id: 'shader', name: '高斯模糊（着色器）', enabled: false, amount: 1, builtin: { id: 'shaders.Blur', params: { intensity: 50 } } }
const vignette = { id: 'vignette', name: '暗角', enabled: true, amount: 1, builtin: { id: 'vignette', params: { amount: -40, midpoint: 50 } } }

describe('效果改版后的旧存档', () => {
  it('含已移除效果与越界旧参数的工程能打开，其余内容正常；已移除的效果原样保留、不渲染，越界值按当前范围使用', () => {
    const raw = structuredClone(content)
    const clip = raw.sequences[0].clips[0]
    clip.effects = [...(clip.effects ?? []), removed, shader, vignette]
    const document = videoEditDocumentSchema.parse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...raw })
    const parsed = document.sequences[0].clips[0]
    expect(parsed.effects?.map(effect => effect.builtin?.id)).toEqual(['color_grade', 'blur', 'brightness_contrast', 'shaders.Blur', 'vignette'])
    expect(parsed.effects?.[2]).toEqual(removed)
    expect(document.sequences[0].captions?.[0].translation).toBe('Golden caption')
    expect(activeVideoEditEffects(parsed).map(effect => effect.builtin?.id)).toEqual(['color_grade', 'blur', 'vignette'])
    expect(evaluateVideoEditClip(parsed, parsed.start + 5).effects?.[2].builtin?.params).toEqual(removed.builtin.params)
    expect(sliceVideoEditBuiltinCurves(removed.builtin, 5, 5)?.brightness?.[0].value).toBe(-7.5)
    expect(resolveVideoEditBuiltinParams(vignette.builtin).amount).toBe(0)
    expect(isRemovedVideoEditBuiltinEffect('brightness_contrast')).toBe(true)
    expect(storedVideoEditBuiltinEffectNotes(removed.builtin)).toEqual({ removed: true, clamped: [] })
    expect(storedVideoEditBuiltinEffectNotes(vignette.builtin)).toEqual({ removed: false, clamped: ['amount'] })
    // 新写入仍按硬范围严格报错，也不能新建已移除的效果。
    expect(() => normalizeVideoEditBuiltinParams('vignette', { amount: -40 })).toThrow('超出范围')
    expect(() => normalizeVideoEditBuiltinParams('brightness_contrast')).toThrow('没有内置效果')
    // 类型不对仍算内容损坏。
    expect(videoEditDocumentSchema.safeParse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...{ ...raw, sequences: [{ ...raw.sequences[0], clips: [{ ...clip, effects: [{ ...vignette, builtin: { id: 'vignette', params: { amount: 'dark' } } }] }, ...raw.sequences[0].clips.slice(1)] }] } }).success).toBe(false)
  })
  it('音频效果链里的已移除效果也照样读入，处理声音时跳过', () => {
    const chain = audioEditEffectChainSchema.parse([{ id: 'old', kind: 'builtin', name: '旧效果', enabled: true, amount: 1, builtin: { id: 'retired_audio', params: { x: 1 } } }])
    expect(chain[0]).toMatchObject({ builtin: { id: 'retired_audio' } })
    expect(audioEditChainItemEffects(chain[0])).toEqual([])
  })
})
