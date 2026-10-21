import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HARDWARE_DECODE_VARIANTS, hardwareDecodes, hardwareEncodes } from '../../../../src/core/media/hardwareCapabilities'
import { HardwareCapabilitiesService, type HardwareCapabilitiesHost } from './hardware-capabilities'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(value => fs.rm(value, { recursive: true, force: true }))) })

async function host(overrides: Partial<HardwareCapabilitiesHost> = {}): Promise<HardwareCapabilitiesHost & { driver: { version: string } }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-hardware-'))
  directories.push(directory)
  const driver = { version: '32.0.16.1047' }
  const nvidia = { description: 'NVIDIA GeForce RTX 4090', vendorId: '0x10de', deviceId: '0x2684', dedicatedVideoMemoryMiB: 24000, software: false }
  const intel = { description: 'Intel(R) UHD Graphics 770', vendorId: '0x8086', deviceId: '0x4680', dedicatedVideoMemoryMiB: 128, software: false }
  return {
    driver,
    gpuDevices: async () => [{ vendorId: 0x10de, deviceId: 0x2684, driverVersion: driver.version, active: true }, { vendorId: 0x8086, deviceId: 0x4680, driverVersion: '31.0' }],
    versions: { electron: '42.5.0', chrome: '148.0' },
    reportFile: () => path.join(directory, 'hardware-capabilities.json'),
    probeClip: name => `/clips/${name}`,
    decoder: {
      adapters: async () => ({ adapters: [nvidia, intel, { description: 'Microsoft Basic Render Driver', vendorId: '0x1414', deviceId: '0x8c', dedicatedVideoMemoryMiB: 0, software: true }], active: nvidia }),
      // Ada decodes 4:2:0 in hardware; 4:2:2 H.264/HEVC falls back to software (RTX 50 adds it).
      decodeFirstFrame: async clip => ({ hardware: clip.includes('-420') }),
    },
    logger: { info: () => undefined, warn: () => undefined },
    ...overrides,
  }
}

describe('hardware capabilities', () => {
  it('records every adapter, decode results per variant and the renderer encode results', async () => {
    const service = new HardwareCapabilitiesService(await host())
    expect((await service.read()).stale).toBe(true)
    const report = await service.detect([{ codec: 'hevc', hardware: true, software: false, maxHardwareSize: { width: 3840, height: 2160 } }])
    expect(report.gpus.map(gpu => [gpu.name, gpu.vendor, gpu.decodes, gpu.driverVersion])).toEqual([
      ['NVIDIA GeForce RTX 4090', 'nvidia', true, '32.0.16.1047'], ['Intel(R) UHD Graphics 770', 'intel', false, '31.0'],
    ])
    expect(report.decode).toHaveLength(HARDWARE_DECODE_VARIANTS.length)
    expect(hardwareDecodes(report, 'hevc', 10, '420')).toBe(true)
    expect(hardwareDecodes(report, 'h264', 8, '422')).toBe(false)
    expect(report.decode.find(item => item.codec === 'h264' && item.chroma === '422' && item.bitDepth === 8)).toMatchObject({ supported: true, hardware: false })
    expect(hardwareEncodes(report, 'hevc')).toBe(true)
    expect((await service.read())).toMatchObject({ stale: false, report: { fingerprint: report.fingerprint } })
  })
  it('becomes stale when the driver changes and records failed opens as unsupported', async () => {
    const owner = await host()
    const service = new HardwareCapabilitiesService({ ...owner, decoder: { ...owner.decoder, decodeFirstFrame: async clip => { if (clip.includes('vp9-10-444')) throw new Error('unsupported'); return { hardware: false } } } })
    const report = await service.detect([])
    expect(report.decode.find(item => item.codec === 'vp9' && item.bitDepth === 10 && item.chroma === '444')).toMatchObject({ supported: false, hardware: false })
    owner.driver.version = '33.0'
    expect((await service.read()).stale).toBe(true)
  })
})
