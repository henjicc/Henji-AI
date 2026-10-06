import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DownloadFailure, downloadVerifiedFile, partPathFor, verifyFile, type DownloadFetch } from './verifiedDownload'

const content = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251))
const spec = { sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }

let dir = ''
let destination = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-verified-download-'))
  destination = path.join(dir, 'model.onnx')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

function streamOf(bytes: Buffer, chunk = 1000): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunk)))
      offset += chunk
    },
  })
}

/** 支持 Range 的假服务器。 */
function server(bytes: Buffer, options: { supportsRange?: boolean; status?: number } = {}): { fetch: DownloadFetch; ranges: string[] } {
  const ranges: string[] = []
  return {
    ranges,
    fetch: async (_url, init) => {
      if (options.status) return new Response(null, { status: options.status })
      const range = init.headers.Range
      ranges.push(range ?? '')
      if (range && options.supportsRange !== false) {
        const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
        return new Response(streamOf(bytes.subarray(start)), { status: 206 })
      }
      return new Response(streamOf(bytes), { status: 200 })
    },
  }
}

describe('带校验的单文件下载', () => {
  it('下载完成并校验通过后原子改名，不留临时文件', async () => {
    const progress: number[] = []
    const result = await downloadVerifiedFile({ url: 'u', destination, spec, fetch: server(content).fetch, onProgress: (bytes) => progress.push(bytes) })
    expect(fs.readFileSync(destination).equals(content)).toBe(true)
    expect(fs.existsSync(partPathFor(destination))).toBe(false)
    expect(result).toEqual({ transferredBytes: content.length, resumedFromBytes: 0 })
    expect(progress.at(-1)).toBe(content.length)
    expect(await verifyFile(destination, spec)).toBe('ok')
  })

  it('已有临时文件时续传：服务器回 206 只传剩余部分', async () => {
    fs.writeFileSync(partPathFor(destination), content.subarray(0, 1500))
    const fake = server(content)
    const result = await downloadVerifiedFile({ url: 'u', destination, spec, fetch: fake.fetch })
    expect(fake.ranges).toEqual(['bytes=1500-'])
    expect(result).toEqual({ transferredBytes: content.length - 1500, resumedFromBytes: 1500 })
    expect(fs.readFileSync(destination).equals(content)).toBe(true)
  })

  it('服务器不支持续传（回 200）时从头写', async () => {
    fs.writeFileSync(partPathFor(destination), Buffer.from('garbage-garbage'))
    await downloadVerifiedFile({ url: 'u', destination, spec, fetch: server(content, { supportsRange: false }).fetch })
    expect(fs.readFileSync(destination).equals(content)).toBe(true)
  })

  it('内容与清单哈希不符：拒绝、删除临时文件、不产生正式文件', async () => {
    const tampered = Buffer.from(content)
    tampered[10] = 0xff
    await expect(downloadVerifiedFile({ url: 'u', destination, spec, fetch: server(tampered).fetch }))
      .rejects.toMatchObject({ kind: 'checksum' })
    expect(fs.existsSync(destination)).toBe(false)
    expect(fs.existsSync(partPathFor(destination))).toBe(false)
  })

  it('HTTP 错误（如仓库不存在的 404）报 http_status', async () => {
    const error = await downloadVerifiedFile({ url: 'u', destination, spec, fetch: server(content, { status: 404 }).fetch }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DownloadFailure)
    expect(error).toMatchObject({ kind: 'http_status', status: 404 })
  })

  it('取消时报 cancelled，并保留已下载部分供下次续传', async () => {
    const controller = new AbortController()
    const fetch: DownloadFetch = async (_url, init) => {
      let sent = false
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          if (!sent) { sent = true; stream.enqueue(new Uint8Array(content.subarray(0, 1000))); return }
          return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
        },
      }), { status: 200 })
    }
    const pending = downloadVerifiedFile({ url: 'u', destination, spec, fetch, signal: controller.signal, onProgress: () => controller.abort() })
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
    expect(fs.statSync(partPathFor(destination)).size).toBe(1000)
    expect(fs.existsSync(destination)).toBe(false)
  })

  it('长时间没有数据按网络失败处理', async () => {
    const fetch: DownloadFetch = async (_url, init) => new Response(new ReadableStream<Uint8Array>({
      pull: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    }), { status: 200 })
    await expect(downloadVerifiedFile({ url: 'u', destination, spec, fetch, stallTimeoutMs: 20 }))
      .rejects.toMatchObject({ kind: 'network' })
  })

  it('校验已有文件：大小或内容不对返回 mismatch，不存在返回 missing', async () => {
    expect(await verifyFile(destination, spec)).toBe('missing')
    fs.writeFileSync(destination, content.subarray(0, 10))
    expect(await verifyFile(destination, spec)).toBe('mismatch')
  })
})
