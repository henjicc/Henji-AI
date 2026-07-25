import { describe, expect, it } from 'vitest';
import { classifyWebGpuFallbackReason } from './imageEditExecution';

describe('图片编辑 WebGPU 降级诊断', () => {
  it('把不可用 API、无 adapter 和初始化失败区分为稳定诊断码', () => {
    expect(classifyWebGpuFallbackReason(
      new Error('当前 Worker 未暴露 navigator.gpu'),
      0
    )).toBe('webgpu-api-unavailable');
    expect(classifyWebGpuFallbackReason(
      new Error('Worker 未找到可用 GPU adapter'),
      0
    )).toBe('webgpu-adapter-unavailable');
    expect(classifyWebGpuFallbackReason(
      new Error('OffscreenCanvas WebGPU context 不可用'),
      0
    )).toBe('webgpu-initialization-failed');
    expect(classifyWebGpuFallbackReason(
      new Error('已脱敏的 Worker 错误'),
      0,
      'webgpu-adapter-unavailable'
    )).toBe('webgpu-adapter-unavailable');
  });

  it('设备连续丢失达到恢复上限时给出独立恢复耗尽诊断', () => {
    expect(classifyWebGpuFallbackReason(
      new Error('WebGPU 设备丢失：test-device-lost'),
      2
    )).toBe('webgpu-device-recovery-exhausted');
  });
});
