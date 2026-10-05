import { describe, expect, it } from 'vitest'

import { createLocationCodec, type LocationContext } from './locationCodec'
import {
  isPathInside,
  joinRelativeSegments,
  parseAbsolutePath,
  pathKey,
  samePath,
} from './pathSyntax'

// 位置换算是纯字符串逻辑，路径写法由参数显式给出，因此 win32 用例在任何平台上都按 Windows 规则执行。
const WIN_USER = 'D:\\文档\\痕迹AI'
const WIN_PROJECT = 'D:\\文档\\痕迹AI\\项目\\我的 项目'
const WIN_OTHER = 'E:\\外部位置\\另一个项目'
const WIN_PROGRAM = 'C:\\Users\\me\\AppData\\Local\\com.henji.ai\\Henji-AI'

function winContext(container: LocationContext['container']): LocationContext {
  return {
    style: 'win32',
    userRoot: WIN_USER,
    projects: [{ id: 'p1', root: WIN_PROJECT }, { id: 'p2', root: WIN_OTHER }],
    programRoots: [WIN_PROGRAM],
    container,
  }
}

describe('路径语法', () => {
  it('Windows 盘符、网络路径、两种分隔符与长路径前缀都能识别，盘符相对路径与设备路径不算', () => {
    expect(parseAbsolutePath('win32', 'D:/a\\b')).toEqual({ root: 'D:', segments: ['a', 'b'] })
    expect(parseAbsolutePath('win32', '\\\\server\\share\\a')).toEqual({ root: '\\\\server\\share', segments: ['a'] })
    expect(parseAbsolutePath('win32', '//server/share/a/b')).toEqual({ root: '\\\\server\\share', segments: ['a', 'b'] })
    expect(parseAbsolutePath('win32', '\\\\?\\D:\\a')).toEqual({ root: 'D:', segments: ['a'] })
    expect(parseAbsolutePath('win32', '\\\\?\\UNC\\server\\share\\a')).toEqual({ root: '\\\\server\\share', segments: ['a'] })
    for (const value of ['D:foo', 'foo\\bar', '\\\\.\\pipe\\x', '/usr/a', 'D:\\a\\b:stream', 'D:\\..\\x', 'D:\\a\nb']) {
      expect(parseAbsolutePath('win32', value)).toBeNull()
    }
  })

  it('POSIX 只认以 / 开头，反斜杠是文件名的一部分', () => {
    expect(parseAbsolutePath('posix', '/home/me/a\\b.png')).toEqual({ root: '', segments: ['home', 'me', 'a\\b.png'] })
    expect(parseAbsolutePath('posix', 'D:/a')).toBeNull()
    expect(parseAbsolutePath('posix', '/../a')).toBeNull()
  })

  it('Windows 下比较不分大小写与分隔符，POSIX 区分大小写；都做 NFC 归一', () => {
    expect(samePath('win32', 'd:/文档/A.PNG', 'D:\\文档\\a.png')).toBe(true)
    expect(samePath('posix', '/a/A.png', '/a/a.png')).toBe(false)
    expect(pathKey('posix', '/a/caf\u0065\u0301')).toBe(pathKey('posix', '/a/caf\u00e9'))
    expect(isPathInside('win32', 'D:\\文档\\痕迹AI', 'd:/文档/痕迹ai/项目/x.png')).toBe(true)
    expect(isPathInside('win32', 'D:\\文档\\痕迹AI', 'D:\\文档\\痕迹AI 2\\x.png')).toBe(false)
  })

  it('拼接拒绝不安全分段并输出原生写法', () => {
    expect(joinRelativeSegments('win32', 'D:\\a', ['b', 'c.png'])).toBe('D:\\a\\b\\c.png')
    expect(joinRelativeSegments('win32', 'D:\\', ['b'])).toBe('D:\\b')
    expect(joinRelativeSegments('posix', '/a', ['b'])).toBe('/a/b')
    for (const segment of ['..', '.', '', 'a/b', 'a\\b', 'C:']) expect(joinRelativeSegments('win32', 'D:\\a', [segment])).toBeNull()
  })
})

describe('单值换算（Windows）', () => {
  const codec = createLocationCodec(winContext({ kind: 'project', projectId: 'p1' }))

  it('容器内写成 henji:/，其他项目写成 henji://project/，作品目录写成 henji://user/，统一正斜杠', () => {
    expect(codec.encode(`${WIN_PROJECT}\\生成结果\\a b.png`).stored).toBe('henji:/生成结果/a b.png')
    expect(codec.encode('d:/文档/痕迹ai/项目/我的 项目/素材/C.mp4').stored).toBe('henji:/素材/C.mp4')
    expect(codec.encode(`${WIN_OTHER}\\素材\\x.mp4`).stored).toBe('henji://project/p2/素材/x.mp4')
    expect(codec.encode(`${WIN_USER}\\生成结果\\y.png`).stored).toBe('henji://user/生成结果/y.png')
  })

  it('外部文件逐字保留并报告；程序目录路径保留并报告', () => {
    const external = codec.encode('F:\\Downloads\\clip.MP4')
    expect(external.stored).toBe('F:\\Downloads\\clip.MP4')
    expect(external.reference).toEqual({ path: 'F:\\Downloads\\clip.MP4', scope: 'external' })
    const program = codec.encode(`${WIN_PROGRAM}\\Thumbnails\\t.webp`)
    expect(program.stored).toBe(`${WIN_PROGRAM}\\Thumbnails\\t.webp`)
    expect(program.programReference).toBe(true)
  })

  it('henji-media://local 与 file:// 先还原成路径再换算；程序内部资源地址原样保留并报告', () => {
    const mediaUrl = `henji-media://local/${encodeURIComponent(`${WIN_PROJECT}\\生成结果\\帧.png`)}`
    expect(codec.encode(mediaUrl).stored).toBe('henji:/生成结果/帧.png')
    const externalMedia = codec.encode(`henji-media://local/${encodeURIComponent('F:\\a.png')}`)
    expect(externalMedia.stored).toBe('F:\\a.png')
    expect(codec.encode('file:///D:/%E6%96%87%E6%A1%A3/%E7%97%95%E8%BF%B9AI/x.png').stored).toBe('henji://user/x.png')
    const resource = codec.encode(`henji-media://image-editor-v3/${'a'.repeat(64)}?mediaType=image%2Fpng`)
    expect(resource.stored.startsWith('henji-media://image-editor-v3/')).toBe(true)
    expect(resource.programReference).toBe(true)
  })

  it('非路径字符串、多行文本与已是存储写法的值保持不变', () => {
    for (const value of ['你好', 'https://example.com/a.png', 'data:image/png;base64,AA', 'D:\\a\nb', 'henji:/a.png', '12']) {
      expect(codec.encode(value)).toEqual({ stored: value })
    }
  })

  it('解码回到原生绝对路径；未知项目、无容器、越界与损坏写法原样保留并报告', () => {
    expect(codec.decode('henji:/生成结果/a b.png').value).toBe(`${WIN_PROJECT}\\生成结果\\a b.png`)
    expect(codec.decode('henji://project/p2/素材/x.mp4').value).toBe(`${WIN_OTHER}\\素材\\x.mp4`)
    expect(codec.decode('henji://user/生成结果/y.png').value).toBe(`${WIN_USER}\\生成结果\\y.png`)
    expect(codec.decode('henji://project/gone/a.png').unresolved).toEqual({ value: 'henji://project/gone/a.png', reason: 'unknown_project', projectId: 'gone' })
    for (const value of ['henji:/../x.png', 'henji:/a/../../x', 'henji:/a\\..\\..\\x', 'henji:/C:/x', 'henji://user/a//b', 'henji://other/a']) {
      const result = codec.decode(value)
      expect(result.value).toBe(value)
      expect(result.unresolved?.reason).toBe('invalid')
    }
    const database = createLocationCodec({ ...winContext(undefined) })
    expect(database.decode('henji:/a.png').unresolved?.reason).toBe('no_container')
  })

  it('往返一致：作品目录内回到原生写法，外部文件逐字不变；等于根目录时也能往返', () => {
    const values = [`${WIN_PROJECT}\\生成结果\\a.png`, `${WIN_OTHER}\\b.mp4`, `${WIN_USER}\\上传素材\\c.wav`, 'F:/外部/d e.mov', WIN_PROJECT]
    for (const value of values) expect(codec.decode(codec.encode(value).stored).value).toBe(value)
    expect(codec.encode(WIN_PROJECT).stored).toBe('henji:/')
    expect(codec.decode('d:/文档/痕迹AI/项目/我的 项目/a.png').reference?.scope).toBe('container')
  })

  it('长路径与网络路径正常换算', () => {
    const deep = `${WIN_PROJECT}\\${Array.from({ length: 30 }, (_, index) => `层级${index}-很长的文件夹名称`).join('\\')}\\x.png`
    expect(deep.length).toBeGreaterThan(260)
    expect(codec.decode(codec.encode(deep).stored).value).toBe(deep)
    const unc = createLocationCodec({ style: 'win32', userRoot: '\\\\nas\\share\\痕迹AI', projects: [], container: { kind: 'user' } })
    expect(unc.encode('\\\\NAS\\share\\痕迹AI\\画布\\a.png').stored).toBe('henji:/画布/a.png')
    expect(unc.decode('henji:/画布/a.png').value).toBe('\\\\nas\\share\\痕迹AI\\画布\\a.png')
  })
})

describe('容器与最深的根', () => {
  it('独立文档以作品目录为容器；项目里的文件仍写成项目写法', () => {
    const codec = createLocationCodec(winContext({ kind: 'user' }))
    expect(codec.encode(`${WIN_USER}\\生成结果\\a.png`).stored).toBe('henji:/生成结果/a.png')
    expect(codec.encode(`${WIN_PROJECT}\\生成结果\\a.png`).stored).toBe('henji://project/p1/生成结果/a.png')
    expect(codec.decode('henji:/生成结果/a.png').value).toBe(`${WIN_USER}\\生成结果\\a.png`)
  })

  it('容器项目不在已知项目里时拒绝建立换算器', () => {
    expect(() => createLocationCodec(winContext({ kind: 'project', projectId: 'missing' }))).toThrow('已知项目')
  })
})

describe('POSIX 换算', () => {
  const codec = createLocationCodec({
    style: 'posix',
    userRoot: '/Users/me/Documents/Henji AI',
    projects: [{ id: 'p1', root: '/Users/me/Documents/Henji AI/Projects/Demo' }],
    programRoots: ['/Users/me/Library/Application Support/com.henji.ai/Henji-AI'],
    container: { kind: 'project', projectId: 'p1' },
  })

  it('区分大小写并保留文件名里的反斜杠', () => {
    expect(codec.encode('/Users/me/Documents/Henji AI/Projects/Demo/Media/a\\b.png').stored).toBe('henji:/Media/a\\b.png')
    expect(codec.encode('/users/me/documents/henji ai/x.png').stored).toBe('/users/me/documents/henji ai/x.png')
    expect(codec.decode('henji:/Media/a\\b.png').value).toBe('/Users/me/Documents/Henji AI/Projects/Demo/Media/a\\b.png')
    expect(codec.decode('henji://user/Generated/x.png').value).toBe('/Users/me/Documents/Henji AI/Generated/x.png')
  })
})

describe('整份内容换算', () => {
  const codec = createLocationCodec(winContext({ kind: 'project', projectId: 'p1' }))

  it('遍历对象键与字符串值，不修改入参，报告去重', () => {
    const content = {
      nodes: [{ data: { imageUrl: `${WIN_PROJECT}\\生成结果\\a.png`, prompt: '保持原样', count: 3, ok: true, empty: null } }],
      cache: { [`${WIN_USER}\\上传素材\\k.png`]: { size: 1 } },
      external: ['F:\\a.mp4', 'f:/A.mp4'],
      resource: `henji-media://image-editor-v3/${'b'.repeat(64)}?mediaType=image%2Fpng`,
    }
    const snapshot = JSON.stringify(content)
    const { content: stored, report } = codec.encodeContent(content)
    expect(JSON.stringify(content)).toBe(snapshot)
    expect(stored).toEqual({
      nodes: [{ data: { imageUrl: 'henji:/生成结果/a.png', prompt: '保持原样', count: 3, ok: true, empty: null } }],
      cache: { 'henji://user/上传素材/k.png': { size: 1 } },
      external: ['F:\\a.mp4', 'f:/A.mp4'],
      resource: content.resource,
    })
    expect(report.references.map((item) => item.scope)).toEqual(['container', 'user', 'external'])
    expect(report.programReferences).toEqual([content.resource])
    expect(JSON.stringify(stored)).not.toContain(WIN_USER.replaceAll('\\', '\\\\'))

    const { content: restored, report: decoded } = codec.decodeContent(stored)
    expect(restored).toEqual({ ...content, cache: { [`${WIN_USER}\\上传素材\\k.png`]: { size: 1 } } })
    expect(decoded.unresolved).toEqual([])
  })

  it('__proto__ 键不会改写原型；过深的内容报错而不是栈溢出', () => {
    const parsed = JSON.parse('{"__proto__": {"polluted": true}, "a": "henji:/x.png"}') as unknown
    const { content } = codec.decodeContent(parsed)
    expect(Object.getPrototypeOf(content)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    let deep: unknown = 'leaf'
    for (let index = 0; index < 1_100; index += 1) deep = [deep]
    expect(() => codec.encodeContent(deep)).toThrow('层级过深')
  })
})
