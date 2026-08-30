import { describe, expect, it } from 'vitest'

import { executeRegistrationWorkerTask } from './worker-task'
import { REGISTRATION_WORKER_PROTOCOL_VERSION } from './worker-contracts'

describe('图像配准 Worker 任务', () => {
  it('算法未达到配准条件时仍返回可用结果和移动像素', () => {
    const movingData = new Uint8Array(4)
    const response = executeRegistrationWorkerTask({
      type: 'registration.run',
      protocolVersion: REGISTRATION_WORKER_PROTOCOL_VERSION,
      requestId: 'worker-task-1',
      referenceFrame: { width: 2, height: 2, components: 1, data: new Uint8Array(4) },
      movingFrame: { width: 2, height: 2, components: 1, data: movingData },
      quality: 'fast',
      forceApplyResult: false,
    })

    expect(response.ok).toBe(true)
    if (!response.ok) throw new Error(response.error.message)
    expect(response.result.success).toBe(false)
    expect(response.movingData).toBe(movingData)
  })
})
