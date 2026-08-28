import { describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES } from './canvasNodes'
import { canvasNodeDefinitions } from './nodeRegistry'

describe('多角度节点定义', () => {
  it('使用特殊编辑器宿主所需的标准生成端口与工具条', () => {
    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.multiAngleGen]).toMatchObject({
      type: 'multiAngleGenNode',
      visibleInMenu: false,
      executionKind: 'standard-generation',
      capabilities: { toolbar: true, promptInput: false, toolbarGenerate: true },
      connectivity: {
        sourceHandle: true,
        targetHandle: true,
        targetHandleMode: 'rows',
      },
      ports: {
        source: { emits: 'image' },
        target: { accepts: ['image'] },
      },
    })
  })

  it('默认数据固定连续档、四视图、无提示词且不进入普通模型选择', () => {
    const data = canvasNodeDefinitions[CANVAS_NODE_TYPES.multiAngleGen].createDefaultData()
    expect(data).toMatchObject({
      capabilityId: 'image.multi-angle',
      modelId: 'fal-qwen-image-edit-2509-multiple-angles',
      prompt: '',
      params: {},
      multiAngleConfig: {
        version: 1,
        controlProfile: 'continuous-v1',
        concurrency: 2,
      },
    })
    expect((data as DynamicValueMap).multiAngleConfig.views).toHaveLength(4)
  })
})
