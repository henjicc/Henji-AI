import { describe, expect, it } from 'vitest'

import {
  getCanvasNodeSchema,
  parseCanvasNodeData,
  parseTrustedMediaNodeData,
  searchCanvasNodeTypes,
} from './nodeControlRegistry'

describe('nodeControlRegistry assistant contract', () => {
  it('用用户语言找到文本提示词与图片生成节点', () => {
    expect(searchCanvasNodeTypes('文本提示词节点').map((item) => item.nodeType))
      .toContain('stringSourceNode')
    expect(searchCanvasNodeTypes('图片生成节点').map((item) => item.nodeType))
      .toContain('imageNode')
  })

  it('公开经过真实连接验证的提示词端口，不要求助手猜 handle', () => {
    expect(getCanvasNodeSchema('stringSourceNode')?.connectionHandles.source)
      .toEqual({ handleId: 'source', purpose: 'source', valueType: undefined })
    expect(getCanvasNodeSchema('imageNode')?.connectionHandles.targets)
      .toContainEqual({ handleId: 'param:__prompt', purpose: 'prompt', valueType: 'STRING' })
  })

  it('外部节点输入继续拒绝媒体路径，正式素材窄通道可承载完整媒体数据', () => {
    const data = {
      imageUrl: 'C:/managed-assets/image.png',
      previewImageUrl: 'henji-media://asset/preview',
      aspectRatio: '16:9',
      sourceFileName: 'image.png',
      isSizeManuallyAdjusted: false,
    }
    expect(() => parseCanvasNodeData('uploadNode', data)).toThrow()
    expect(parseTrustedMediaNodeData('uploadNode', data)).toMatchObject({
      nodeType: 'uploadNode',
      data,
    })
  })
})
