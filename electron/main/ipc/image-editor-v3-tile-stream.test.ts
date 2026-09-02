import { describe, expect, it, vi } from 'vitest'

import type { SharpSourceProvider } from '../services/image-editor-v3'
import { streamImageEditorV3TilesWithCredits } from './image-editor-v3-tile-stream'

class FakePort {
  readonly posted: unknown[] = []
  readonly transfers: Transferable[][] = []
  private readonly messageListeners = new Set<(event: { data: unknown }) => void>()

  on(event: string, listener: (event: { data: unknown }) => void): this {
    if (event === 'message') this.messageListeners.add(listener)
    return this
  }

  off(event: string, listener: (event: { data: unknown }) => void): this {
    if (event === 'message') this.messageListeners.delete(listener)
    return this
  }

  start(): void {}

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.posted.push(message)
    this.transfers.push(transfer)
  }

  credit(count: number): void {
    for (const listener of this.messageListeners) listener({ data: { type: 'credit', count } })
  }
}

function payload() {
  return {
    requestId: 'stream-request',
    tiles: Array.from({ length: 6 }, (_, index) => ({
      resourceRef: `sha256:${'a'.repeat(64)}` as const,
      mip: 1,
      tileX: index,
      tileY: 0,
      halo: 0,
      bitDepth: 8 as const,
      priority: 5 - index,
    })),
  }
}

function sourceTile(tileX: number) {
  return {
    resourceId: `sha256:${'a'.repeat(64)}` as const,
    mip: 1, tileX, tileY: 0, halo: 0,
    width: 1, height: 1, channels: 4 as const, bitDepth: 8 as const,
    sampleFormat: 'uint' as const, numericRange: 'unorm8' as const,
    byteOrder: 'little-endian' as const, rowStride: 4,
    colorSpace: 'srgb' as const, transferFunction: 'srgb' as const,
    alphaMode: 'straight' as const, orientationApplied: true as const,
    originX: tileX, originY: 0, pixels: new Uint8Array([tileX, 0, 0, 255]),
  }
}

describe('图片编辑主进程瓦片 credit 流', () => {
  it('没有 credit 不解码，最多保留四块在途并按原请求索引返回', async () => {
    const readTile = vi.fn(async ({ tileX }: { tileX: number }) => sourceTile(tileX))
    const port = new FakePort()
    const operation = streamImageEditorV3TilesWithCredits(
      { readTile } as unknown as SharpSourceProvider,
      payload(),
      port as never,
      new AbortController().signal,
    )

    expect(readTile).not.toHaveBeenCalled()
    port.credit(4)
    port.credit(4)
    await vi.waitFor(() => expect(port.posted).toHaveLength(4))
    expect(readTile).toHaveBeenCalledTimes(4)
    expect(readTile.mock.calls.map(([request]) => request.tileX)).toEqual([5, 4, 3, 2])
    expect(port.transfers.every((transfer) => transfer.length === 1)).toBe(true)

    port.credit(2)
    await operation
    expect(readTile).toHaveBeenCalledTimes(6)
    expect(port.posted.map((event) => (event as { index: number }).index).sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5])
  })

  it('取消后停止发布迟到瓦片', async () => {
    let finish: ((value: ReturnType<typeof sourceTile>) => void) | null = null
    const readTile = vi.fn(() => new Promise<ReturnType<typeof sourceTile>>((resolve) => {
      finish = resolve
    }))
    const port = new FakePort()
    const controller = new AbortController()
    const operation = streamImageEditorV3TilesWithCredits(
      { readTile } as unknown as SharpSourceProvider,
      payload(),
      port as never,
      controller.signal,
    )
    port.credit(1)
    controller.abort(new Error('cancelled'))
    finish?.(sourceTile(5))

    await expect(operation).rejects.toThrow('cancelled')
    await Promise.resolve()
    expect(port.posted).toHaveLength(0)
  })
})
