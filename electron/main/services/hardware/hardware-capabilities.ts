import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import {
  HARDWARE_CAPABILITIES_VERSION, HARDWARE_DECODE_VARIANTS, hardwareCapabilitiesReportSchema, hardwareProbeClipName,
  type HardwareCapabilitiesReport, type HardwareCapabilitiesState, type HardwareDecodeResult, type HardwareEncodeResult, type HardwareGpu,
} from '../../../../src/core/media/hardwareCapabilities'

/**
 * 本机硬件编解码能力的检测与记录（主进程部分）。
 * - 指纹：显卡（厂商/型号/驱动）与 Electron、Chromium 版本；任一变化即视为过期，由渲染层在后台重新检测。
 * - 解码：原生解码服务逐个打开随包测试视频并解码首帧，记录是否走硬件；所有显卡（含核显）只列出名称，
 *   实际解码在原生服务选用的那块显卡上进行。
 * - 编码：WebCodecs 只在渲染层可用，结果由渲染层带来一起写入。
 */
export interface GpuDeviceInfo { vendorId: number; deviceId: number; driverVersion?: string; active?: boolean }
export interface DecoderAdapterInfo { description: string; vendorId: string; deviceId: string; dedicatedVideoMemoryMiB: number; software: boolean; luid?: string }

export interface HardwareCapabilitiesHost {
  gpuDevices(): Promise<GpuDeviceInfo[]>
  versions: { electron: string; chrome: string }
  reportFile(): string
  probeClip(name: string): string | null
  decoder: {
    adapters(): Promise<{ adapters: DecoderAdapterInfo[]; active: DecoderAdapterInfo | null }>
    /** 打开并解码首帧；返回是否走了硬件。打不开时抛错。 */
    decodeFirstFrame(path: string): Promise<{ hardware: boolean }>
  }
  logger: { info(message: string, data: Record<string, unknown>): void; warn(message: string, data: Record<string, unknown>): void }
}

function vendorOf(id: number): HardwareGpu['vendor'] {
  return id === 0x10de ? 'nvidia' : id === 0x1002 || id === 0x1022 ? 'amd' : id === 0x8086 ? 'intel' : id === 0x106b ? 'apple' : 'other'
}
function parseId(value: string): number { return value.startsWith('0x') ? Number.parseInt(value.slice(2), 16) : Number(value) }

export class HardwareCapabilitiesService {
  private detecting: Promise<HardwareCapabilitiesReport> | undefined
  constructor(private readonly host: HardwareCapabilitiesHost) {}

  async fingerprint(): Promise<string> {
    const devices = (await this.host.gpuDevices()).map(device => `${device.vendorId}:${device.deviceId}:${device.driverVersion ?? ''}`).sort()
    return createHash('sha256').update(JSON.stringify([HARDWARE_CAPABILITIES_VERSION, devices, this.host.versions.electron, this.host.versions.chrome])).digest('hex')
  }

  async read(): Promise<HardwareCapabilitiesState> {
    let report: HardwareCapabilitiesReport | null = null
    try { report = hardwareCapabilitiesReportSchema.parse(JSON.parse(await fs.readFile(this.host.reportFile(), 'utf8'))) } catch { /* none yet or unreadable: detect again */ }
    return { report, stale: !report || report.fingerprint !== await this.fingerprint() }
  }

  /** 检测解码能力并与渲染层的编码结果合并写入；同时只跑一次。 */
  detect(encode: HardwareEncodeResult[]): Promise<HardwareCapabilitiesReport> {
    this.detecting ??= this.run(encode).finally(() => { this.detecting = undefined })
    return this.detecting
  }

  private async run(encode: HardwareEncodeResult[]): Promise<HardwareCapabilitiesReport> {
    const started = Date.now()
    this.host.logger.info('开始检测本机硬件编解码能力', { event: 'hardware.capabilities.start' })
    const devices = await this.host.gpuDevices()
    let adapters: DecoderAdapterInfo[] = []
    let active: DecoderAdapterInfo | null = null
    try { ({ adapters, active } = await this.host.decoder.adapters()) } catch (error) {
      this.host.logger.warn('原生解码服务不可用，解码能力按不支持记录', { event: 'hardware.capabilities.decoder_unavailable', error })
    }
    // 虚拟显示器（远程桌面、串流软件）会让同一块显卡在适配器列表里出现多次：按型号与显存合并成一项。
    const gpus: HardwareGpu[] = []
    for (const adapter of adapters.filter(value => !value.software)) {
      const vendorId = parseId(adapter.vendorId), deviceId = parseId(adapter.deviceId)
      const device = devices.find(value => value.vendorId === vendorId && value.deviceId === deviceId)
      const decodes = !!active && (active.luid && adapter.luid ? active.luid === adapter.luid : active.description === adapter.description && active.deviceId === adapter.deviceId)
      const gpu: HardwareGpu = { name: adapter.description.trim(), vendor: vendorOf(vendorId), driverVersion: device?.driverVersion || null, dedicatedMemoryMiB: adapter.dedicatedVideoMemoryMiB, decodes }
      const same = gpus.find(value => value.name === gpu.name && value.dedicatedMemoryMiB === gpu.dedicatedMemoryMiB)
      if (same) same.decodes ||= gpu.decodes
      else gpus.push(gpu)
    }
    const decode: HardwareDecodeResult[] = []
    for (const variant of HARDWARE_DECODE_VARIANTS) {
      const clip = this.host.probeClip(hardwareProbeClipName(variant))
      let supported = false, hardware = false
      if (clip && active) {
        try { hardware = (await this.host.decoder.decodeFirstFrame(clip)).hardware; supported = true }
        catch (error) { this.host.logger.info('测试视频无法解码', { event: 'hardware.capabilities.decode_unsupported', context: { ...variant }, error }) }
      }
      decode.push({ ...variant, supported, hardware })
    }
    const report = hardwareCapabilitiesReportSchema.parse({
      version: HARDWARE_CAPABILITIES_VERSION, fingerprint: await this.fingerprint(), detectedAt: Date.now(),
      electron: this.host.versions.electron, chrome: this.host.versions.chrome, gpus, decode, encode,
    })
    await fs.writeFile(this.host.reportFile(), JSON.stringify(report, null, 2))
    this.host.logger.info('本机硬件编解码能力检测完成', { event: 'hardware.capabilities.completed', context: {
      elapsedMs: Date.now() - started, gpus: gpus.map(gpu => gpu.name),
      hardwareDecode: decode.filter(item => item.hardware).map(item => `${item.codec}-${item.bitDepth}-${item.chroma}`),
      hardwareEncode: encode.filter(item => item.hardware).map(item => item.codec),
    } })
    return report
  }
}
