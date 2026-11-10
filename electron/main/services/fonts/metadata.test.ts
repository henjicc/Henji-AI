import fs from 'node:fs'
import { expect, it } from 'vitest'
import { parseFontFile } from './metadata'

it('可变字体记录全部变化轴，命名实例照旧展开；实例名引用 nameID 2 时不再整份解析失败', () => {
  // 夹具由 fontTools 生成：wght 100–900（默认 400）与自定义轴 GRAD，实例 Thin / Regular（nameID 2）/ Bold。
  const faces = parseFontFile(fs.readFileSync('tests/fixtures/fonts/henji-test-variable.ttf')).map(entry => entry.face)
  const axes = [{ tag: 'wght', name: 'Weight', min: 100, default: 400, max: 900 }, { tag: 'GRAD', name: 'Grade', min: -1, default: 0, max: 1 }]
  expect(faces.map(face => [face.style, face.variation, face.axes])).toEqual([
    ['Regular', undefined, axes],
    ['Thin', { wght: 100, GRAD: 0 }, axes],
    ['Bold', { wght: 700, GRAD: 0 }, axes],
  ])
})
