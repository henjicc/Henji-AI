import { testCodeAssetSource } from './codeMaterial/sourceTestFixtures'
import { expect, it } from 'vitest'
import { codeElementOverrideStatus, codeElementOverridesSchema, evaluateCodeElementOverride, readCodeElementOverride } from './codeElementOverrides'
import { snapCodeElementMove } from './codeElementManipulation'
import { CODE_ASSET_VERSION, decodeCodeAsset, encodeCodeAsset } from './codeAsset'
import { createVideoEditTestDocument } from './testFixtures'
import { makeVideoEditItemClip } from './projectItems'

const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
it('元素覆盖的源时间曲线也使用左点的贝塞尔控制点', () => {
  const value = codeElementOverridesSchema.parse({ box: { curves: { dx: [{ id: 'a', ...time(0), value: 0, interpolation: 'bezier', bezier: [1 / 3, 0, 2 / 3, 0] }, { id: 'b', ...time(1e6), value: 100, interpolation: 'linear' }] } } }).box
  expect(evaluateCodeElementOverride(value, time(500000)).dx).toBeCloseTo(12.5, 5)
})
it('曲线使用源时间、保持bool和ease插值；非法属性/重复时刻拒绝', () => {
  const curve = (value: number, id: string, sourceInUs: number) => ({ id, ...time(sourceInUs), value, interpolation: 'ease' as const })
  const override = codeElementOverridesSchema.parse({ box: { dx: 10, curves: { dx: [curve(0, 'a', 0), curve(100, 'b', 1e6)], hidden: [{ id: 'hidden', ...time(0), value: true, interpolation: 'hold' }] } } }).box
  expect(evaluateCodeElementOverride(override, time(250000)).dx).toBeCloseTo(15.625)
  expect(evaluateCodeElementOverride(override, time(2e6))).toMatchObject({ dx: 100, hidden: true })
  expect(codeElementOverridesSchema.safeParse({ box: { curves: { unknown: [curve(0, 'x', 0)] } } }).success).toBe(false)
  expect(codeElementOverridesSchema.safeParse({ box: { curves: { dx: [curve(0, 'x', 0), curve(1, 'y', 0)] } } }).success).toBe(false)
  expect(codeElementOverridesSchema.safeParse({ box: { curves: { text: [curve(0, 'x', 0)] } } }).success).toBe(false)
})
it('未声明的外观覆盖与曲线必须拒绝，不允许保存后静默忽略', () => {
  for (const [key, value] of Object.entries({ fill: [1,0,0,1], stroke: [0,0,0,1], text: 'new', fontSize: 40, fontFamily: 'serif', fontWeight: 700, letterSpacing: 2, lineHeight: 2 })) {
    expect(codeElementOverridesSchema.safeParse({ box: { [key]: value } }).success).toBe(false)
    expect(codeElementOverridesSchema.safeParse({ box: { curves: { [key]: [{ id: key, ...time(0), value, interpolation: 'hold' }] } } }).success).toBe(false)
  }
})
it('只有明确的源码身份列表才标记失效，缺失元素仍保留覆盖', () => {
  const ids = new Set(['box'])
  expect(codeElementOverrideStatus({ box: { dx: 1 }, gone: { hidden: true } }, ids)).toEqual([{ elementId: 'box', missing: false }, { elementId: 'gone', missing: true }])
})
it('元素贝塞尔过冲按透明度范围夹取，不中断绘制', () => {
  const curve = [{ id: 'a', ...time(0), value: 0, interpolation: 'bezier' as const, bezier: [1 / 3, 3, 2 / 3, 3] as [number, number, number, number] }, { id: 'b', ...time(1000000), value: 1, interpolation: 'linear' as const }]
  const value = codeElementOverridesSchema.parse({ box: { curves: { opacity: curve } } }).box
  expect(evaluateCodeElementOverride(value, time(500000))).toMatchObject({ opacity: 1 })
})
it('任意作者ID不读取字典原型；危险对象保留名称显式拒绝', () => {
  expect(readCodeElementOverride({}, 'constructor')).toBeUndefined()
  expect(codeElementOverridesSchema.safeParse(JSON.parse('{"__proto__":{"dx":10}}')).success).toBe(false)
})
it('移动按屏幕阈值吸附画面中心、安全边与其它边缘', () => {
  const snapped = snapCodeElementMove([{ x: .1, y: .1 }, { x: .3, y: .3 }], { x: .297, y: .648 }, { x: [.5], y: [.95] }, { x: .006, y: .006 })
  expect(snapped.delta.x).toBeCloseTo(.3); expect(snapped.delta.y).toBeCloseTo(.65); expect(snapped.guides).toEqual({ x: .5, y: .95 })
})
it('代码资产编码/导入默认值/新片段复制保留覆盖，并保持片段编辑独立', () => {
  const code = 'export default { name: "编辑", draw() {} }'
  const asset = decodeCodeAsset(encodeCodeAsset({ format: 'henji-code-asset', version: CODE_ASSET_VERSION, name: '编辑', ...testCodeAssetSource(code), parameters: {}, images: [], elementOverrides: { box: { dx: 20 } } }))
  const document = createVideoEditTestDocument('导入'); document.codeMaterials = [{ id: 'd', name: '编辑', defaultVersionId: 'v', versions: [{ id: 'v', ...asset.sourceVersion }] }]; document.items.push({ id: 'i', name: '编辑', kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: {} }, elementOverrides: asset.elementOverrides })
  const clip = makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, () => ({ name: '编辑', kind: 'generator', mode: 'dynamic', seed: 0, parameters: [], width: 1920, height: 1080, durationSeconds: 10 }))
  expect(clip.elementOverrides).toEqual(asset.elementOverrides); clip.elementOverrides!.box.dx = 90; expect(asset.elementOverrides!.box.dx).toBe(20)
})
