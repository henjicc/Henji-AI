import fs from 'node:fs'
import { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { parseChunked, stringifyChunked } from '@discoveryjs/json-ext'
import { writeBufferAtomically } from './atomic-file'

/** 保留内存中的业务对象，避免额外驻留整份 JSON 字符串和 UTF-8 副本。 */
export function jsonChunks(value: unknown): Readable {
  return Readable.from((function* () {
    yield* stringifyChunked(value)
    yield '\n'
  })())
}

export async function readJsonStream(chunks: AsyncIterable<string | Uint8Array>): Promise<unknown> {
  async function* withoutBom(): AsyncGenerator<string> {
    const decoder = new StringDecoder('utf8')
    let first = true
    for await (const chunk of chunks) {
      // 只剥整份 JSON 的 BOM，分片边界上的正文 U+FEFF 必须保留。
      const text = typeof chunk === 'string' ? decoder.end() + chunk : decoder.write(chunk)
      if (text.length === 0) continue
      yield first && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
      first = false
    }
    const tail = decoder.end()
    if (tail) yield tail
  }
  return await parseChunked(withoutBom()) as unknown
}

export async function readJsonFile(filePath: string, onChunk?: (chunk: Uint8Array) => void): Promise<unknown> {
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for await (const chunk of fs.createReadStream(filePath)) {
      onChunk?.(chunk)
      yield chunk
    }
  }
  return await readJsonStream(chunks())
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeBufferAtomically(filePath, jsonChunks(value))
}
