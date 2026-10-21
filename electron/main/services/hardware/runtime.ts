import { app } from 'electron'
import { getProgramFilePath } from '../appPaths'
import { createMainLogger } from '../logging'
import { resolveBundledResourcePath } from '../media/bundledResources'
import { getVideoDecoderService } from '../video-decoder'
import { HardwareCapabilitiesService, type GpuDeviceInfo } from './hardware-capabilities'

let service: HardwareCapabilitiesService | undefined
let probeCounter = 0
export function getHardwareCapabilitiesService(): HardwareCapabilitiesService {
  service ??= new HardwareCapabilitiesService({
    gpuDevices: async () => {
      try {
        const info = await app.getGPUInfo('complete') as { gpuDevice?: Array<{ vendorId?: number; deviceId?: number; driverVersion?: string; active?: boolean }> }
        return (info.gpuDevice ?? []).filter((device): device is GpuDeviceInfo => typeof device.vendorId === 'number' && typeof device.deviceId === 'number')
      } catch { return [] }
    },
    versions: { electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '' },
    reportFile: () => getProgramFilePath('hardware-capabilities.json'),
    probeClip: name => resolveBundledResourcePath(`hardware-probe/${name}`),
    decoder: {
      adapters: async () => {
        const hello = await getVideoDecoderService().ensureStarted()
        return hello.d3d11.available ? { adapters: hello.d3d11.adapters, active: hello.d3d11.adapter } : { adapters: [], active: null }
      },
      decodeFirstFrame: async path => {
        const decoder = getVideoDecoderService()
        const streamId = `hwprobe-${++probeCounter}`
        // 打开解码会话会实际解码首帧来确定输出格式；结果里的 hardware 就是首帧是否由硬件解出。
        const started = await decoder.openDecoder({ streamId, path, purpose: 'seek', poolSize: 2 }, { timeoutMs: 15_000 })
        await decoder.stopStream(streamId).catch(() => undefined)
        return { hardware: started.decoder.hardware }
      },
    },
    logger: createMainLogger('main.hardware'),
  })
  return service
}
