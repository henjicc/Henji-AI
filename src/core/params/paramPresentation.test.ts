import { describe, expect, it } from 'vitest'

import type { ModelParamPresentation, ParamDef } from '@/core/types'
import {
  buildParamPresentationItems,
  getPresentedParamIds,
  resolveParamPresentationSections,
} from './paramPresentation'
import { validateParamPresentation } from '@/core/validators/paramPresentationValidator'

const params: ParamDef[] = [
  { id: 'ratio', type: 'dropdown', order: 1, name: '比例', default: '1:1', options: [{ value: '1:1', label: '1:1' }] },
  { id: 'speed', type: 'dropdown', order: 2, name: '速度', default: 'fast', options: [{ value: 'fast', label: '快速' }] },
  { id: 'style', type: 'number', order: 3, name: '风格', default: 100, min: 0, max: 1000 },
  { id: 'extra', type: 'text', order: 4, name: '附加参数', default: '' },
]

const presentation: ModelParamPresentation = {
  groups: [{
    id: 'advanced',
    name: '高级设置',
    order: 3,
    sections: [
      { id: 'style', name: '风格', paramIds: ['style'] },
      { id: 'extra', name: '高级', paramIds: ['extra'] },
    ],
  }],
}

describe('paramPresentation', () => {
  it('只组合展示，不改变原参数 ID 与扁平值结构', () => {
    expect([...getPresentedParamIds(presentation)]).toEqual(['style', 'extra'])
    expect(buildParamPresentationItems(params, presentation)).toEqual([
      expect.objectContaining({ kind: 'param', param: expect.objectContaining({ id: 'ratio' }) }),
      expect.objectContaining({ kind: 'param', param: expect.objectContaining({ id: 'speed' }) }),
      expect.objectContaining({
        kind: 'group',
        group: expect.objectContaining({ id: 'advanced' }),
        params: [
          expect.objectContaining({ id: 'style' }),
          expect.objectContaining({ id: 'extra' }),
        ],
      }),
    ])
  })

  it('可见性过滤后自动移除空分区', () => {
    const group = presentation.groups[0]
    expect(resolveParamPresentationSections(group, params.filter((param) => param.id !== 'extra')))
      .toEqual([{ section: group.sections[0], params: [params[2]] }])
  })

  it('拒绝展示组引用不存在或重复的参数 ID', () => {
    const invalidPresentation: ModelParamPresentation = {
      groups: [{
        ...presentation.groups[0],
        sections: [{ id: 'invalid', name: '无效', paramIds: ['missing'] }],
      }],
    }
    expect(() => validateParamPresentation(
      { params, paramPresentation: invalidPresentation },
      (message) => { throw new Error(message) }
    )).toThrow('references non-existent param: missing')
  })
})
