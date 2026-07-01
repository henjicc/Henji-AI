import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getUploadsDir } from '../image/path-utils'
import { normalizeLocalSource } from '../image/source'

const MAX_BUFFER_BYTES = 32 * 1024 * 1024

/**
 * 执行外部二进制并以 Buffer（而非字符串）接收 stdout，供需要读取二进制输出
 * （截帧 PNG/webp、PCM 音频采样等）的调用方使用。
 */
export function execFileAsyncBuffer(binaryPath: string, args: string[]): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { maxBuffer: MAX_BUFFER_BYTES, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${path.basename(binaryPath)} failed: ${error.message}\n${stderr.toString()}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

/**
 * 本地路径 / henji-media:// URL 直接校验存在性；http(s) 远程地址先下载到临时 Uploads 目录，
 * 供 ffmpeg/ffprobe 等只能处理本地文件的命令行工具使用。视频/音频共用同一套解析逻辑。
 */
export async function resolveLocalMediaPath(source: string): Promise<string> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('Media source is empty')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return await downloadToTempFile(trimmed)
  }
  const localPath = normalizeLocalSource(trimmed)
  await fs.promises.access(localPath, fs.constants.R_OK)
  return localPath
}

async function downloadToTempFile(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Remote media request failed with status ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const ext = path.extname(new URL(url).pathname) || '.bin'
  const targetPath = path.join(getUploadsDir(), `${crypto.randomUUID()}${ext}`)
  await fs.promises.writeFile(targetPath, bytes)
  return targetPath
}
