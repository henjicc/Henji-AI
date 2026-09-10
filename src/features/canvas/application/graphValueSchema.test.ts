import { afterEach, describe, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import type { ParamDef } from '@/core/types'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { findParamForTargetNode } from './graphValueSchema'

const target = { id: 'edit', type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: { modelId: 'test-model', prompt: '' } } as CanvasNode
const parameter: ParamDef = { id: 'reference', type: 'image-upload', name: { zh: '参考图', en: 'Reference' }, default: [], order: 1 }

afterEach(() => { vi.restoreAllMocks() })

describe('画布端口 schema 查询', () => {
  it.each(['__image', '__video', '__audio', '__model', '__prompt'])('保留端口 %s 不扫描模型目录，即使节点尺寸持续变化', id => {
    const schema = vi.spyOn(registry, 'getSchema')
    const list = vi.spyOn(registry, 'getModelsByType')
    for (let width = 300; width < 400; width++) {
      expect(findParamForTargetNode({ ...target, width }, id)).toBeUndefined()
    }
    expect(schema).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
  it('真实模型参数仍从当前模型查询，缺失参数保留原有兜底', () => {
    vi.spyOn(registry, 'getSchema').mockReturnValue([parameter])
    const list = vi.spyOn(registry, 'getModelsByType').mockReturnValue([])
    expect(findParamForTargetNode(target, 'reference')).toBe(parameter)
    expect(list).not.toHaveBeenCalled()
    expect(findParamForTargetNode(target, 'missing')).toBeUndefined()
    expect(list).toHaveBeenCalledWith('image')
  })
})
