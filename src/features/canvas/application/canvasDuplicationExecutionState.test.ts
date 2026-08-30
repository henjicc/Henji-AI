import { describe, expect, it } from 'vitest'

import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import { resetDuplicatedCanvasExecutionData } from './canvasDuplicationExecutionState'

describe('resetDuplicatedCanvasExecutionData', () => {
  it('复制多角度配方时不继承原批次、结果占位或缓存', () => {
    const data: DynamicValueMap = {
      prompt: '保留输入',
      latestExecution: { version: 1 },
      multiAngleBatch: { version: 1 },
      multiAngleResultPlaceholderId: 'original-result',
      imageUrl: 'legacy-output.png',
      isGenerating: true,
    }

    resetDuplicatedCanvasExecutionData(CANVAS_NODE_TYPES.multiAngleGen, data)

    expect(data).toMatchObject({ prompt: '保留输入', imageUrl: null, isGenerating: false })
    expect(data).not.toHaveProperty('latestExecution')
    expect(data).not.toHaveProperty('multiAngleBatch')
    expect(data).not.toHaveProperty('multiAngleResultPlaceholderId')
  })

  it('复制文本配方时保留策略但清空计算结果', () => {
    const data: DynamicValueMap = {
      prompt: '改写',
      fixedResult: false,
      lastOutput: '旧结果',
      lastOutputRevision: 3,
      lastExecutionStatus: 'success',
    }

    resetDuplicatedCanvasExecutionData(CANVAS_NODE_TYPES.textProcessing, data)

    expect(data).toMatchObject({
      prompt: '改写',
      fixedResult: false,
      lastOutput: '',
      lastOutputRevision: 0,
    })
    expect(data).not.toHaveProperty('lastExecutionStatus')
  })
})
