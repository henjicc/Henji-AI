import { describe, expect, it } from 'vitest'

import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  getCanvasImageCapability,
} from '@/features/canvas/capabilities'
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry'

import {
  partitionCanvasImageCapabilities,
  resolveCanvasImageCapabilityActionsForSourceNode,
  resolveCanvasImageCapabilityInlineCapacity,
  resolveCanvasImageCapabilityMenuFocusIndex,
} from './canvasImageCapabilityLayout'

describe('图片能力工具条响应式容量', () => {
  it.each([
    [1440, 4],
    [1360, 4],
    [1280, 3],
    [1080, 3],
    [960, 2],
    [760, 2],
    [720, 1],
  ])('%d 像素窗口最多直显 %d 项能力', (viewportWidth, expected) => {
    expect(resolveCanvasImageCapabilityInlineCapacity(viewportWidth)).toBe(expected)
  })

  it('优先直显常用且可执行的能力，其余能力只进入单一更多菜单', () => {
    const sourceNode: CanvasNode = {
      id: 'image-source',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: 0, y: 0 },
      data: { imageUrl: 'managed-source.png', aspectRatio: '1:1' },
    }
    const actions = resolveCanvasImageCapabilityActionsForSourceNode(sourceNode)
    const partition = partitionCanvasImageCapabilities(actions, 4)

    expect(partition.inline.map(({ capability }) => capability.id)).toEqual([
      CANVAS_IMAGE_CAPABILITY_IDS.elementEdit,
      CANVAS_IMAGE_CAPABILITY_IDS.upscale,
      CANVAS_IMAGE_CAPABILITY_IDS.relight,
      CANVAS_IMAGE_CAPABILITY_IDS.panorama,
    ])
    expect(partition.overflowGroups.map(({ group }) => group)).toEqual([
      'transformation',
      'structure',
      'local',
    ])
    expect(partition.overflowGroups
      .flatMap(({ actions: groupActions }) => groupActions)
      .find(({ capability }) => capability.id === CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation))
      .toMatchObject({
        disabledReasonKey: null,
      })
  })

  it('图片节点尚无内容时保留可恢复入口并说明原因', () => {
    const emptyImageNode: CanvasNode = {
      id: 'empty-image-source',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: 0, y: 0 },
      data: { imageUrl: '', aspectRatio: '1:1' },
    }
    const actions = resolveCanvasImageCapabilityActionsForSourceNode(emptyImageNode)

    expect(actions.length).toBeGreaterThan(0)
    expect(actions.every(({ disabledReasonKey }) => (
      disabledReasonKey === 'imageCapabilities.unavailable.sourceNotReady'
    ))).toBe(true)
    expect(partitionCanvasImageCapabilities(actions, 4).inline).toEqual([])
  })

  it.each([
    CANVAS_NODE_TYPES.imageEdit,
    CANVAS_NODE_TYPES.panoramaGen,
    CANVAS_NODE_TYPES.relightGen,
    CANVAS_NODE_TYPES.upscaleGen,
    CANVAS_NODE_TYPES.portraitTextureGen,
    CANVAS_NODE_TYPES.elementEditGen,
    CANVAS_NODE_TYPES.storyboardGen,
    CANVAS_NODE_TYPES.multiAngleGen,
    CANVAS_NODE_TYPES.layerSeparationGen,
  ])('%s 尚无结果时不显示空图片能力菜单', (nodeType) => {
    const generator: CanvasNode = {
      id: `generator-${nodeType}`,
      type: nodeType,
      position: { x: 0, y: 0 },
      data: canvasNodeDefinitions[nodeType].createDefaultData(),
    }
    expect(resolveCanvasImageCapabilityActionsForSourceNode(generator)).toEqual([])
  })

  it('完全不适用的非图片节点不显示图片能力', () => {
    const textNode: CanvasNode = {
      id: 'text-source',
      type: CANVAS_NODE_TYPES.textAnnotation,
      position: { x: 0, y: 0 },
      data: { text: '说明' },
    }

    expect(resolveCanvasImageCapabilityActionsForSourceNode(textNode)).toEqual([])
  })

  it('分组函数不会把禁用项放入直达区', () => {
    const capability = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation)
    if (!capability) throw new Error('缺少图层分离能力')
    const partition = partitionCanvasImageCapabilities([{
      capability,
      disabledReasonKey: 'imageCapabilities.unavailable.layerSeparationValidation',
    }], 4)

    expect(partition.inline).toEqual([])
    expect(partition.overflowGroups[0]?.actions).toHaveLength(1)
  })

  it('菜单方向键循环移动，Home 与 End 直达边界', () => {
    expect(resolveCanvasImageCapabilityMenuFocusIndex(-1, 5, 'ArrowDown')).toBe(0)
    expect(resolveCanvasImageCapabilityMenuFocusIndex(-1, 5, 'ArrowUp')).toBe(4)
    expect(resolveCanvasImageCapabilityMenuFocusIndex(4, 5, 'ArrowDown')).toBe(0)
    expect(resolveCanvasImageCapabilityMenuFocusIndex(0, 5, 'ArrowUp')).toBe(4)
    expect(resolveCanvasImageCapabilityMenuFocusIndex(3, 5, 'Home')).toBe(0)
    expect(resolveCanvasImageCapabilityMenuFocusIndex(1, 5, 'End')).toBe(4)
    expect(resolveCanvasImageCapabilityMenuFocusIndex(0, 0, 'ArrowDown')).toBe(-1)
  })
})
