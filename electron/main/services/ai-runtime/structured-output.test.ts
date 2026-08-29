import { describe, expect, it } from 'vitest'

import type { StructuredGenerationLayerStackV1 } from '@henjicc/ai-sdk'

import { materializeStructuredOutput } from './structured-output'

const output: StructuredGenerationLayerStackV1 = {
  version: 1,
  kind: 'layer-stack',
  primary: { version: 1, sourceOutputIndex: 1, url: 'https://fixtures.invalid/base.jpg', zIndex: 0, role: 'base', width: 8, height: 8, format: 'jpeg' },
  outputs: [
    { version: 1, sourceOutputIndex: 1, url: 'https://fixtures.invalid/base.jpg', zIndex: 0, role: 'base', width: 8, height: 8, format: 'jpeg' },
    { version: 1, sourceOutputIndex: 0, url: 'https://fixtures.invalid/title.png', zIndex: 1, role: 'content', width: 3, height: 2, format: 'png', boundingBox: { absolute: [2, 3, 5, 5] } },
  ],
  metadata: { colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', order: 'bottom-to-top' },
}

describe('ai-runtime structured output', () => {
  it('按 sourceOutputIndex 注入路径并保持 bottom-to-top 输出顺序与 primary', () => {
    const result = materializeStructuredOutput(output, '/managed/title.png|||/managed/base.jpg')
    expect(result?.outputs.map((item) => [item.zIndex, item.filePath])).toEqual([
      [0, '/managed/base.jpg'],
      [1, '/managed/title.png'],
    ])
    expect(result?.primary.filePath).toBe('/managed/base.jpg')
  })

  it('未完成落盘的索引不伪造 filePath', () => {
    const result = materializeStructuredOutput(output, '/managed/title.png')
    expect(result?.outputs[0].filePath).toBeUndefined()
    expect(result?.outputs[1].filePath).toBe('/managed/title.png')
  })
})
