import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureExecutableBinary } from './ffmpeg-loader'

describe.runIf(process.platform !== 'win32')('ensureExecutableBinary', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('修复开发目录里被 npm 缓存丢失的可执行权限', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-binary-mode-'))
    const binaryPath = path.join(tempDir, 'ffmpeg')
    await fs.writeFile(binaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o644 })

    await expect(ensureExecutableBinary(binaryPath)).resolves.toBe(binaryPath)
    expect((await fs.stat(binaryPath)).mode & 0o111).not.toBe(0)
  })
})
