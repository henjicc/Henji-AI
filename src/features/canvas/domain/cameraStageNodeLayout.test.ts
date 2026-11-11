import { describe, expect, it } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode } from './canvasNodes'
import { fitCameraStageNodeToAspect } from './cameraStageNodeLayout'

const stageNode = (aspectRatio: string, width: number, height: number): CanvasNode => ({
  id: 'stage', type: CANVAS_NODE_TYPES.cameraStage, position: { x: 0, y: 0 },
  width, height, style: { width, height }, data: { aspectRatio },
} as CanvasNode)

describe('3D 镜头参考节点外框跟画面比例', () => {
  it('旧画布里还算着底部一行的高被改回宽 ÷ 比例，外框、样式与测量同一份尺寸', () => {
    const fitted = fitCameraStageNodeToAspect(stageNode('16:9', 480, 330))
    expect(fitted).toMatchObject({ width: 480, height: 270, style: { width: 480, height: 270 }, measured: { width: 480, height: 270 } })
  })

  it('渲染后换成竖屏比例时外框跟着变高', () => {
    expect(fitCameraStageNodeToAspect(stageNode('9:16', 270, 152)).height).toBe(480)
  })

  it('已经对上的节点原样返回，不制造无谓的更新', () => {
    const node = stageNode('16:9', 480, 270)
    expect(fitCameraStageNodeToAspect(node)).toBe(node)
  })
})
