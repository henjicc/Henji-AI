import { expect, it } from 'vitest'
import { jsonChunks, readJsonStream } from './json-file'

it('分块读取保留原型同名自有字段与跨片 UTF-8，往返不改变 JSON 内容', async () => {
  const text = '{"first":0,"__proto__":{"own":1},"中文":"跨片🙂","constructor":2}'
  async function* chunks(): AsyncGenerator<Uint8Array> {
    const bytes = Buffer.from(text)
    for (let offset = 0; offset < bytes.length; offset += 11) yield bytes.subarray(offset, offset + 11)
  }
  const value = await readJsonStream(chunks())
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
  expect(Object.hasOwn(value as object, '__proto__')).toBe(true)
  expect(value).toEqual(JSON.parse(text))
  expect(await readJsonStream(jsonChunks(value))).toEqual(JSON.parse(text))
})

it('仅移除文件开头的 BOM，正文片首的 BOM 和跨片多字节字符完整保留', async () => {
  async function* chunks(): AsyncGenerator<Uint8Array> {
    yield Buffer.from([0xef])
    yield Buffer.from([0xbb, 0xbf])
    yield Buffer.from('{"text":"')
    yield Buffer.from('\ufeff正文')
    const bytes = Buffer.from('🙂"}')
    yield bytes.subarray(0, 2)
    yield bytes.subarray(2)
  }
  expect(await readJsonStream(chunks())).toEqual({ text: '\ufeff正文🙂' })
})
