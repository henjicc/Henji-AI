import { describe, expect, it } from 'vitest'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { clipCodeProjectClosures, codeMaterialsUsingProjectFile, codeProjectRows, outdatedProjectCodeMaterials } from './videoEditCodeProjectModel'

const H = (n: number): string => String(n).repeat(64).slice(0, 64)
const PATHS = ['README.md', 'entries/02-search/window.ts', 'entries/01-opening/window.ts', 'entries/shared/background.ts', 'style/dot-matrix/tokens.ts', 'style/dot-matrix/parts/tag.ts']
const version = (id: string, files: [string, number][], project = true) => ({ id, entry: files[0][0], files: files.map(([path, hash]) => ({ path, location: `git:x#${path}`, hash: H(hash) })), ...(project ? { project: { commit: 'a'.repeat(40), entry: files[0][0] } } : {}) })
const document = {
  codeMaterials: [
    { id: 'win', name: '开场 · 录屏窗口', defaultVersionId: 'v2', versions: [version('v1', [['entries/01-opening/window.ts', 1]]), version('v2', [['entries/01-opening/window.ts', 1], ['style/dot-matrix/tokens.ts', 2]])] },
    { id: 'desk', name: '全片 · 台面', defaultVersionId: 'd1', versions: [version('d1', [['entries/shared/background.ts', 3], ['style/dot-matrix/tokens.ts', 2]])] },
    { id: 'old', name: '旧素材', defaultVersionId: 'o1', versions: [version('o1', [['main.ts', 4]], false)] },
  ],
  sequences: [{ id: 's', clips: [{ id: 'c1', code: { definitionId: 'win', versionId: 'v2' }, effects: [{ code: { definitionId: 'old', versionId: 'o1' } }] }, { id: 'c2' }] }],
} as unknown as VideoEditDocument

describe('代码工程面板数据', () => {
  it('文件夹在前、按名称和序号排，折起的文件夹不展开', () => {
    expect(codeProjectRows(PATHS, new Set(['entries'])).map(row => `${row.depth}:${row.name}`)).toEqual(['0:entries', '1:01-opening', '1:02-search', '1:shared', '0:style', '0:README.md'])
  })
  it('只看所选片段用到的文件时，所在文件夹全部展开', () => {
    expect(codeProjectRows(PATHS, new Set(), new Set(['entries/01-opening/window.ts', 'style/dot-matrix/tokens.ts'])).map(row => row.path)).toEqual(['entries', 'entries/01-opening', 'entries/01-opening/window.ts', 'style', 'style/dot-matrix', 'style/dot-matrix/tokens.ts'])
  })
  it('片段用到的文件只算工程入口素材，效果链里的非工程素材不算', () => {
    const closures = clipCodeProjectClosures(document, 's', 'c1')
    expect(closures.map(value => [value.name, value.entry, [...value.paths]])).toEqual([['开场 · 录屏窗口', 'entries/01-opening/window.ts', ['entries/01-opening/window.ts', 'style/dot-matrix/tokens.ts']]])
    expect(clipCodeProjectClosures(document, 's', 'c2')).toEqual([])
    expect(clipCodeProjectClosures(document, 's', null)).toEqual([])
  })
  it('按默认版本列出用到某个文件的素材，并标出入口', () => {
    expect(codeMaterialsUsingProjectFile(document, 'style/dot-matrix/tokens.ts').map(value => value.name)).toEqual(['开场 · 录屏窗口', '全片 · 台面'])
    expect(codeMaterialsUsingProjectFile(document, 'entries/shared/background.ts')).toEqual([{ definitionId: 'desk', name: '全片 · 台面', entry: true }])
  })
  it('用到的文件在工作区里改了或删了才算旧版本；外部改过还没提交的不算', () => {
    const files = [{ path: 'entries/01-opening/window.ts', hash: H(1) }, { path: 'style/dot-matrix/tokens.ts', hash: H(9) }]
    expect(outdatedProjectCodeMaterials(document, { files: files as never, changes: [] })).toEqual([
      { definitionId: 'win', name: '开场 · 录屏窗口', changedPaths: ['style/dot-matrix/tokens.ts'] },
      { definitionId: 'desk', name: '全片 · 台面', changedPaths: ['entries/shared/background.ts', 'style/dot-matrix/tokens.ts'] },
    ])
    expect(outdatedProjectCodeMaterials(document, { files: files as never, changes: [{ path: 'style/dot-matrix/tokens.ts', kind: 'modified' }] }).map(value => value.definitionId)).toEqual(['desk'])
  })
})
