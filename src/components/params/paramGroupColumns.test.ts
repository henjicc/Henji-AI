import { describe, expect, it } from 'vitest'

import type { ParamDef, ParamPresentationGroup } from '@/core/types'
import { resolveParamGroupBodyWidth, splitParamGroupSections } from './paramGroupColumns'

const param = (id: string, type: ParamDef['type'] = 'number'): ParamDef => ({ id, type, name: id } as ParamDef)
const section = (id: string, params: ParamDef[]) => ({ section: { id, name: id, paramIds: params.map((item) => item.id) }, params })

describe('参数组分节排布', () => {
  it('参数少或只有一节时一列', () => {
    expect(splitParamGroupSections([section('a', [param('a1'), param('a2')]), section('b', [param('b1')])])).toHaveLength(1)
    expect(splitParamGroupSections([section('a', Array.from({ length: 12 }, (_, index) => param(`a${index}`)))])).toHaveLength(1)
  })

  it('分节多时按高度最接近处断成两列，顺序不变；上传按两行算', () => {
    // Midjourney：模型 2、风格 7、参考控制 4 个权重 + 3 个上传、高级 1 + 多行文本
    const model = section('model', [param('version', 'dropdown'), param('niji', 'switch')])
    const style = section('style', Array.from({ length: 7 }, (_, index) => param(`style${index}`)))
    const references = section('references', [
      param('imageWeight'), param('cref', 'image-upload'), param('cw'), param('sref', 'image-upload'), param('sw'),
      param('dref', 'image-upload'), param('dw'),
    ])
    const advanced = section('advanced', [param('stop'), param('extra', 'textarea')])
    const columns = splitParamGroupSections([model, style, references, advanced])
    expect(columns.map((column) => column.map((item) => item.section.id))).toEqual([['model', 'style'], ['references', 'advanced']])
  })

  it('两列时正文宽 = 两列 320 + 间隔 24，一列时取分组声明的宽度', () => {
    const params = Array.from({ length: 8 }, (_, index) => param(`p${index}`))
    const group: ParamPresentationGroup = {
      id: 'g', name: 'g', order: 1, panelWidth: 480,
      sections: [{ id: 's1', name: 's1', paramIds: params.slice(0, 4).map((item) => item.id) }, { id: 's2', name: 's2', paramIds: params.slice(4).map((item) => item.id) }],
    }
    expect(resolveParamGroupBodyWidth(group, params)).toBe(664)
    expect(resolveParamGroupBodyWidth(group, params.slice(0, 5))).toBe(480)
  })
})
