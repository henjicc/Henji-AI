import type { WebContents } from 'electron'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fromWebContents: vi.fn() }))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
}))

import { SURFACE_OBSERVATION_SCHEMA_VERSION } from '../../../../src/core/assistant/surfaceObservation'
import { captureApplicationSurface } from './surfaceCapture'

describe('captureApplicationSurface', () => {
  const capturePage = vi.fn()
  const sender = {
    id: 7,
    isDestroyed: () => false,
    capturePage,
  } as unknown as WebContents

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.fromWebContents.mockReturnValue({
      isDestroyed: () => false,
      webContents: { id: 7 },
      getContentSize: () => [1_200, 900],
    })
    const source = await sharp({
      create: { width: 100, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    }).png().toBuffer()
    capturePage.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => source,
      getSize: () => ({ width: 100, height: 80 }),
    })
  })

  it('只捕获请求区域并在输出前覆盖遮罩', async () => {
    const result = await captureApplicationSurface(sender, {
      schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION,
      target: 'settings.providers_models',
      rect: { x: 20, y: 30, width: 100, height: 80 },
      masks: [{ x: 10, y: 10, width: 20, height: 20 }],
      maskPolicyId: 'surface.mask_sensitive_fields',
    })

    expect(capturePage).toHaveBeenCalledWith({ x: 20, y: 30, width: 100, height: 80 })
    expect(result.maskedRegionCount).toBe(1)
    const bytes = Buffer.from(result.dataUrl.split(',')[1], 'base64')
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    const maskedPixel = (15 * info.width + 15) * info.channels
    const clearPixel = (2 * info.width + 2) * info.channels
    expect([...data.subarray(maskedPixel, maskedPixel + 3)]).toEqual([24, 24, 27])
    expect([...data.subarray(clearPixel, clearPixel + 3)]).toEqual([255, 255, 255])
  })

  it('拒绝越过当前应用内容区域的请求', async () => {
    await expect(captureApplicationSurface(sender, {
      schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION,
      target: 'workspace.canvas',
      rect: { x: 1_150, y: 20, width: 100, height: 80 },
      masks: [],
      maskPolicyId: 'surface.mask_declared_fields',
    })).rejects.toThrow('SURFACE_CAPTURE_OUT_OF_BOUNDS')
    expect(capturePage).not.toHaveBeenCalled()
  })
})
