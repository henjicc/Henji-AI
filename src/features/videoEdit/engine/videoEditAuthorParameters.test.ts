import { APP_ACCENT_HEX, BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { describe, expect, it } from 'vitest'
import { authorParameterMetadata, authorParameterValues } from './videoEditAuthorParameters'
import { validateCodeMaterialParameterValue } from '@/core/videoEdit/codeMaterial/parameters'
import { parseCodeMaterialTypes } from '@/core/videoEdit/codeMaterial/parameterTypes'
import { codeMaterialAnimatedParameterValueSchema } from '@/core/videoEdit/codeMaterial/parameterValueSchema'

describe('作者 JS 参数适配', () => {
  it('保留 Frameflow 范围和颜色语义，不改动原声明', () => {
    const params = [{ key: 'power', label: '强度', type: 'range', min: -1e15, max: 1e15, step: .001, default: 2 }, { key: 'color', type: 'color', default: `${APP_ACCENT_HEX}80` }]
    const metadata = authorParameterMetadata({ params })
    expect(metadata.parameters[0]).toMatchObject({ type: 'number', title: '强度', min: -1e15, max: 1e15 })
    expect(authorParameterValues(metadata, {})).toEqual({ power: 2, color: `${APP_ACCENT_HEX}80` })
    expect(authorParameterValues(metadata, { color: [1, 1, 1, 1] }).color).toBe(WHITE_HEX)
    expect(params[0].type).toBe('range')
    expect(params[1].default).toBe(`${APP_ACCENT_HEX}80`)
  })

  it('文字样式绑定图层并经统一样式校验、持久化；拒绝非法字号', () => {
    const metadata = authorParameterMetadata({ params: [
      { key: 'title', type: 'text', layer: 'heading', default: '标题' },
      { key: 'style', type: 'textStyle', layer: 'heading', default: { fontFamily: 'Example', fontSize: 64, strokes: [{ enabled: true, color: BLACK_HEX, width: 3, position: 'outside' }] } },
    ] })
    const style = metadata.parameters[1]
    expect(style).toMatchObject({ layer: 'heading', default: { fontFamily: 'Example', fontSize: 64, leading: 0 } })
    expect(codeMaterialAnimatedParameterValueSchema.parse(style.default)).toEqual(style.default)
    expect(validateCodeMaterialParameterValue(style, style.default)).toEqual(style.default)
    expect(() => validateCodeMaterialParameterValue(style, { fontSize: -1 })).toThrow()
    expect(() => parseCodeMaterialTypes({ nested: { title: '组合', layout: 'row', fields: { style: { type: 'textStyle', title: '样式', default: {} } } } })).toThrow('基础参数类型')
  })

  it('选择项转换保留可见名称，重复参数明确报错', () => {
    const params = [{ key: 'mode', type: 'select', default: 'a', options: [{ value: 'a', label: '甲', labelEnglish: 'A' }] }]
    expect(authorParameterMetadata({ params }).parameters[0]).toMatchObject({ type: 'choice', options: ['a'], optionLabels: { a: '甲' } })
    expect(() => authorParameterMetadata({ params: [...params, ...params] })).toThrow('重复')
  })

  it('数据表保存文字和完整样式，键唯一，内容修改不改变其他行', () => {
    const metadata = authorParameterMetadata({ params: [{ key: 'nodes', type: 'table', rowKey: 'id', fields: {
      id: { type: 'text', title: '键', default: '', maxLength: 64 },
      title: { type: 'text', title: '文案', default: '节点', maxLength: 200 },
      style: { type: 'textStyle', title: '样式', default: { fontSize: 48 } },
    }, default: [{ id: 'a' }, { id: 'b', title: '第二项' }] }] })
    const table = metadata.parameters[0]
    expect(table.default).toMatchObject([{ id: 'a', title: '节点', style: { fontSize: 48 } }, { id: 'b', title: '第二项' }])
    expect(codeMaterialAnimatedParameterValueSchema.parse(table.default)).toEqual(table.default)
    expect(() => validateCodeMaterialParameterValue(table, [{ id: 'a', title: '一', style: {} }, { id: 'a', title: '二', style: {} }])).toThrow('唯一')
    expect(() => validateCodeMaterialParameterValue(table, [{ id: 'a' }])).toThrow()
    expect(codeMaterialAnimatedParameterValueSchema.safeParse([]).success).toBe(true)
  })
})
