import { app } from 'electron'
import { createMainLogger } from './services/logging/main-logger'

const logger = createMainLogger('main.webgpu')

/**
 * 在 Chromium 读取命令行之前启用桌面端 WebGPU，并避免在双显卡机器上错误选中
 * 低性能设备。显式传入 --disable-gpu / --disable-webgpu 时尊重用户选择。
 */
export function configureWebGpuRuntime(): void {
  const gpuExplicitlyDisabled = app.commandLine.hasSwitch('disable-gpu')
    || app.commandLine.hasSwitch('disable-webgpu')
  if (gpuExplicitlyDisabled) {
    logger.warn('WebGPU 启动开关未启用：GPU 被显式禁用', {
      event: 'webgpu.startup.disabled',
      context: { reason: 'gpu-disabled-by-command-line' },
    })
    return
  }
  if (!app.commandLine.hasSwitch('enable-unsafe-webgpu')) {
    app.commandLine.appendSwitch('enable-unsafe-webgpu')
  }
  if (!app.commandLine.hasSwitch('force_low_power_gpu')) {
    app.commandLine.appendSwitch('force_high_performance_gpu')
  }
  logger.info('WebGPU 启动开关已配置', {
    event: 'webgpu.startup.configured',
    context: { highPerformancePreferred: true },
  })
}

/** 在 GPU 子进程完成初始化后记录安全的特性状态，供日志窗口定位开关或驱动禁用。 */
export function registerWebGpuDiagnostics(): void {
  app.once('gpu-info-update', () => {
    const featureStatus = app.getGPUFeatureStatus()
    logger.info('GPU 特性状态已就绪', {
      event: 'webgpu.gpu_info.completed',
      context: {
        webgpu: readFeatureStatus(featureStatus, 'webgpu'),
        compositing: normalizeFeatureStatus(featureStatus.gpu_compositing),
        rasterization: normalizeFeatureStatus(featureStatus.rasterization),
      },
    })
  })
}

function normalizeFeatureStatus(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 80) : 'unknown'
}

function readFeatureStatus(
  featureStatus: Electron.GPUFeatureStatus,
  feature: string
): string {
  const values = featureStatus as unknown as Record<string, unknown>
  return normalizeFeatureStatus(values[feature])
}
