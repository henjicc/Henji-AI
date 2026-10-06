import { afterEach, describe, expect, it } from 'vitest'

import { findWorkRootBusyReason, registerWorkRootBusyProbe, resetWorkRootBusyProbesForTest } from './busy-probes'

describe('作品目录更换前的统一忙碌检查', () => {
  afterEach(() => resetWorkRootBusyProbesForTest())

  it('都空闲时为 null；任一长任务在进行时返回它的原因', () => {
    let exporting = false
    registerWorkRootBusyProbe('generation', { reason: '还有生成结果正在保存', isBusy: () => false })
    registerWorkRootBusyProbe('video_frame_export', { reason: '还有视频正在导出', isBusy: () => exporting })
    expect(findWorkRootBusyReason()).toBeNull()
    exporting = true
    expect(findWorkRootBusyReason()).toBe('还有视频正在导出')
  })

  it('同一 ID 重复登记以最后一次为准；探针出错按忙碌处理', () => {
    registerWorkRootBusyProbe('image_raster_export', { reason: '旧', isBusy: () => true })
    registerWorkRootBusyProbe('image_raster_export', { reason: '还有图片正在导出', isBusy: () => false })
    expect(findWorkRootBusyReason()).toBeNull()
    registerWorkRootBusyProbe('audio_edit_task', { reason: '口播还有处理任务在进行', isBusy: () => { throw new Error('读取失败') } })
    expect(findWorkRootBusyReason()).toBe('口播还有处理任务在进行')
  })
})
