import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadSharp } from '../image/sharp-loader'
import type { ResourceId, SourceImageMetadata } from './contracts'
import type { DerivedDiskCache } from './derived-disk-cache'
import { readFastSourceProxy } from './source-fast-proxy'
import type { ManagedSourcePyramid } from './source-pyramid'

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

describe('readFastSourceProxy', () => {
  it('冷缓存只解码一次有界粗层，再把它切成金字塔瓦片', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-source-proxy-'))
    temporaryRoots.push(root)
    const sourcePath = path.join(root, 'source.png')
    await sharp({
      create: {
        width: 1_200,
        height: 600,
        channels: 3,
        background: { r: 51, g: 102, b: 153 },
      },
    }).png().toFile(sourcePath)
    const resourceId = `sha256:${'a'.repeat(64)}` as ResourceId
    const metadata: SourceImageMetadata = {
      resourceId,
      width: 1_200,
      height: 600,
      encodedWidth: 1_200,
      encodedHeight: 600,
      bitsPerSample: 8,
      orientation: 1,
      orientationApplied: true,
      hasAlpha: false,
      hasIccProfile: false,
      cicp: null,
      hdr: false,
    }
    const cache = {
      maxEntryBytes: 32 * 1024 * 1024,
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      invalidate: vi.fn(async () => undefined),
    } as unknown as DerivedDiskCache
    const pyramid = {
      hasCompleteLevel: vi.fn(async () => false),
      readBoundedRawLevel: vi.fn(async () => {
        throw new Error('冷缓存不应逐瓦片回读粗层')
      }),
      seedRawLevel: vi.fn(async ({ level }) => level.columns * level.rows),
    } as unknown as ManagedSourcePyramid
    type LoadedSharp = Awaited<ReturnType<typeof loadSharp>>
    const realSharp = await loadSharp()
    const sourceInputs: string[] = []
    const invoke = realSharp as unknown as (
      input: unknown,
      options?: unknown,
    ) => ReturnType<LoadedSharp>
    const sharpLoader = vi.fn(async () => ((input: unknown, options?: unknown) => {
      if (typeof input === 'string') sourceInputs.push(input)
      return invoke(input, options)
    }) as unknown as LoadedSharp)

    const result = await readFastSourceProxy({
      resourceId,
      sourcePath,
      metadata,
      maxDimension: 512,
      maximumInputPixels: 10_000_000,
      sharpLoader,
      cache,
      pyramid,
    })

    expect(result).toMatchObject({ width: 512, height: 256, format: 'webp' })
    expect(sourceInputs).toEqual([sourcePath])
    expect(pyramid.seedRawLevel).toHaveBeenCalled()
    expect(pyramid.readBoundedRawLevel).not.toHaveBeenCalled()
  })
})
