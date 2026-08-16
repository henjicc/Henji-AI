import { describe, expect, it } from 'vitest'
import { mediaSourceNodeData, mediaSourceNodeType } from './assetMediaAssignment'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import type { AssetDragPayload } from '@/features/assets/drag/assetDragPayload'

const payload = (type: AssetDragPayload['type']): AssetDragPayload => ({ assetId: 'a1', type, filePath: 'C:/media/demo.bin', imageUrl: 'henji-media://demo', sourceType: 'asset', aspectRatio: '9:16', durationSeconds: 8 })

describe('asset media assignment', () => {
  it.each([
    ['image', CANVAS_NODE_TYPES.upload, 'imageUrl'],
    ['video', CANVAS_NODE_TYPES.videoUpload, 'videoUrl'],
    ['audio', CANVAS_NODE_TYPES.audioUpload, 'audioUrl'],
  ] as const)('将 %s 资产映射到正确源节点', (type, nodeType, field) => {
    expect(mediaSourceNodeType(type)).toBe(nodeType)
    expect(mediaSourceNodeData(payload(type))[field]).toBe('C:/media/demo.bin')
  })

  it('把媒体比例和视频时长带入节点初始数据以触发首次自适应尺寸', () => {
    expect(mediaSourceNodeData(payload('image'))).toMatchObject({ aspectRatio: '9:16', isSizeManuallyAdjusted: false })
    expect(mediaSourceNodeData(payload('video'))).toMatchObject({ aspectRatio: '9:16', durationSec: 8, isSizeManuallyAdjusted: false })
  })
})
