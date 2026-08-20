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
    expect(searchCanvasNodeTypes('AI 图片').map((item) => item.nodeType))
      .toContain('imageNode')
    expect(searchCanvasNodeTypes('AI 视频').map((item) => item.nodeType))
      .toContain('videoGenNode')
    expect(searchCanvasNodeTypes('AI 音频').map((item) => item.nodeType))
      .toContain('audioGenNode')
  })

  it('公开经过真实连接验证的提示词端口，不要求助手猜 handle', () => {
    expect(getCanvasNodeSchema('stringSourceNode')?.connectionHandles.source)
      .toEqual({ handleId: 'source', purpose: 'source', valueType: undefined })
    expect(getCanvasNodeSchema('imageNode')?.connectionHandles.targets)
      .toContainEqual({ handleId: 'param:__prompt', purpose: 'prompt', valueType: 'STRING' })
    expect(getCanvasNodeSchema('textProcessingNode')?.connectionHandles.targets)
      .toContainEqual({ handleId: 'param:__prompt', purpose: 'prompt', valueType: 'STRING' })
  })

  it('用大语言模型相关称呼找到文本处理节点', () => {
    expect(searchCanvasNodeTypes('LLM 节点').map((item) => item.nodeType))
      .toContain('textProcessingNode')
  })

  it('文本处理节点允许创建时设置系统提示词', () => {
    expect(parseCanvasNodeData('textProcessingNode', {
      prompt: '总结正文',
      systemPrompt: '只输出 Markdown。',
      systemPromptTemplateId: 'image-optimizer',
    }).data).toMatchObject({
      prompt: '总结正文',
      systemPrompt: '只输出 Markdown。',
      systemPromptTemplateId: 'image-optimizer',
    })
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
