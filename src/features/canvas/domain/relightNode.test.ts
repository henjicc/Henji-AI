import { describe, expect, it } from 'vitest'

import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities'
import { CANVAS_NODE_TYPES } from './canvasNodes'
import { canvasNodeDefinitions } from './nodeRegistry'

describe('图片打光节点定义', () => {
  it('使用专用界面、逐行源图端口和普通图片结果', () => {
    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.relightGen]).toMatchObject({
      type: 'relightGenNode',
      visibleInMenu: false,
      executionKind: 'standard-generation',
      capabilities: { toolbarGenerate: true },
      connectivity: { targetHandleMode: 'rows' },
      ports: {
        source: { emits: 'image' },
        target: { accepts: ['image'] },
      },
      generation: {
        modelType: 'image',
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
      },
    })
  })

  it('默认数据固化 V1 设置与手动模式模板', () => {
    expect(canvasNodeDefinitions[CANVAS_NODE_TYPES.relightGen].createDefaultData()).toMatchObject({
      displayName: '图片打光',
      capabilityId: CANVAS_IMAGE_CAPABILITY_IDS.relight,
      promptTemplateVersion: 'relight-manual-iclight-v1',
      relightSettings: {
        relightContractVersion: 1,
        lightingMode: 'manual',
        manual: { keyDirection: 'none', brightness: 0, colorPreset: 'neutral', rimDirection: 'off' },
        smart: { preset: 'natural-studio', lightingReferenceImages: [] },
      },
      lightingReferenceImages: [],
      mediaInputs: {},
    })
  })
})
