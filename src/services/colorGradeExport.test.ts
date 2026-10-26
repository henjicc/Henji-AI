// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { colorGradeDefaults } from '@/core/imaging/adjustments/schema'
import { buildColorGradeExport, ColorGradeExportRejection } from '@/core/imaging/lut/colorGradeExport'
import type { ColorGradeExportWorkerRequest } from '@/core/imaging/lut/colorGradeExport.worker'
import { colorGradeExportReceipt, exportColorGradeFile } from './colorGradeExport'

/** Runs the worker body inline: same request/response contract as colorGradeExport.worker.ts. */
class InlineColorGradeExportWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  postMessage(request: ColorGradeExportWorkerRequest): void {
    queueMicrotask(() => {
      try { this.onmessage?.({ data: { build: buildColorGradeExport({ ...request, luts: new Map(request.luts) }) } }) }
      catch (error) { this.onmessage?.({ data: { error: error instanceof Error ? error.message : String(error), rejected: error instanceof ColorGradeExportRejection } }) }
    })
  }
  terminate(): void {}
}

const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.stubGlobal('Worker', InlineColorGradeExportWorker)
  const fs = getPlatform().system.fs
  vi.spyOn(fs, 'exists').mockImplementation(async path => files.has(path))
  vi.spyOn(fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(fs, 'readTextFile').mockImplementation(async path => { const text = files.get(path); if (text === undefined) throw new Error('missing'); return text })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

const params = { ...colorGradeDefaults(), temperature_kelvin: 5400, exposure: .2, contrast: 12, saturation: 10, vignette_amount: -30 }

it('写出 .cube 后读回核对，回执带格点、未包含项与验证结论', async () => {
  const result = await exportColorGradeFile({ params, format: 'cube', path: 'D:/out/镜头.cube', title: '镜头' })
  expect(files.get('D:/out/镜头.cube')).toContain('LUT_3D_SIZE 33')
  expect(result).toMatchObject({ format: 'cube', lutSize: 33, omitted: ['晕影'] })
  expect(result.accuracy.meanDeltaE).toBeLessThan(.2)
  const receipt = colorGradeExportReceipt(result)
  expect(receipt.verification.verified).toBe(true)
  expect(receipt.message).toContain('未包含晕影')
})

it('写入前的问题都在写文件之前拒绝：扩展名不符、目标已存在、CDL 表达不了', async () => {
  await expect(exportColorGradeFile({ params, format: 'cube', path: 'D:/out/a.cdl', title: 'a' })).rejects.toBeInstanceOf(ColorGradeExportRejection)
  files.set('D:/out/a.cube', 'old')
  await expect(exportColorGradeFile({ params, format: 'cube', path: 'D:/out/a.cube', title: 'a' })).rejects.toThrow('overwrite')
  expect(files.get('D:/out/a.cube')).toBe('old')
  const selective = { ...colorGradeDefaults(), mixer_red_hue: 100, mixer_red_saturation: 100, mixer_blue_hue: -100, mixer_green_saturation: -100, mixer_yellow_luminance: -100, contrast: 60 }
  await expect(exportColorGradeFile({ params: selective, format: 'cdl', path: 'D:/out/b.cdl', title: 'b' })).rejects.toBeInstanceOf(ColorGradeExportRejection)
  expect(files.has('D:/out/b.cdl')).toBe(false)
  await expect(exportColorGradeFile({ params, format: 'cube', path: 'D:/out/a.cube', title: 'a', overwrite: true })).resolves.toMatchObject({ format: 'cube' })
})

it('简单的白平衡与曝光可导出 CDL，回执带 SOP 与饱和度', async () => {
  const result = await exportColorGradeFile({ params: { ...colorGradeDefaults(), temperature_kelvin: 5600, exposure: .2 }, format: 'cdl', path: 'D:/out/c.cdl', title: 'c' })
  expect(result.cdl?.slope).toHaveLength(3)
  expect(result.accuracy.meanDeltaE).toBeLessThan(1.5) // 实测 0.94
  expect(colorGradeExportReceipt(result).verification.verified).toBe(true)
})
