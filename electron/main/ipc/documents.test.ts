import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DocumentsPlatform } from '../../../src/platform/contracts/documents'

type Handler = (input: unknown) => unknown
const mock = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), service: {} as Record<string, ReturnType<typeof vi.fn<unknown[], Promise<unknown>>>> }))

vi.mock('./registry', () => ({
  parseVoid: (input: unknown) => { if (input !== undefined) throw new Error('Expected no IPC payload') },
  registerIpcHandler: (channel: string, parse: (input: unknown) => unknown, handler: (input: unknown) => unknown) => {
    mock.handlers.set(channel, (input) => handler(parse(input)))
  },
}))
vi.mock('../services/documents/runtime', () => ({ getDocumentService: () => mock.service }))

import { createDocumentsApi } from '../../preload/documents-api'
import { registerDocumentsIpc } from './documents'

const METHODS: Array<keyof DocumentsPlatform> = [
  'listDocumentsPage', 'listProjectsPage', 'listDocuments', 'readDocument', 'createDocument', 'saveDocument', 'renameDocument', 'finalizeDocument', 'moveDocument',
  'duplicateDocument', 'trashDocument', 'deleteEmptyDraft', 'forgetDocument', 'revealDocument', 'resolveDocumentLink', 'checkName',
  'getDocumentCover', 'saveDocumentCover', 'refreshIndex', 'readSessionState', 'writeSessionState', 'listProjects', 'createProject', 'renameProject', 'finalizeProject',
  'trashProject', 'registerExternalProject', 'registerExternalDocument', 'forgetExternalLocation', 'revealProject',
  'exportDocumentPackage', 'exportProjectPackage', 'importPackage',
]

function api(): DocumentsPlatform {
  return createDocumentsApi(async <T>(channel: string, payload?: unknown) => {
    const handler = mock.handlers.get(channel)
    if (!handler) throw new Error(`未注册的通道：${channel}`)
    return await handler(payload) as T
  })
}

beforeEach(() => {
  mock.handlers.clear()
  mock.service = Object.fromEntries(METHODS.map((method) => [method, vi.fn(async (..._args: unknown[]): Promise<unknown> => method)]))
  registerDocumentsIpc()
})

describe('文档底座 IPC 契约（preload 桥 → 主进程校验 → DocumentService）', () => {
  it('每个方法都注册了通道，参数原样到达服务', async () => {
    const bridge = api()
    const target = { id: 'doc-1', path: '/work/a.henji-canvas' }
    const calls: Array<[keyof DocumentsPlatform, unknown[], unknown[]]> = [
      ['listDocuments', [undefined], [{}]],
      ['listDocumentsPage', [{ kind: 'canvas', cursor: 'cursor', pageSize: 17 }], [{ kind: 'canvas', cursor: 'cursor', pageSize: 17 }]],
      ['listDocuments', [{ kind: 'canvas', container: { kind: 'project', projectId: 'p1' }, includeDrafts: false }], [{ kind: 'canvas', container: { kind: 'project', projectId: 'p1' }, includeDrafts: false }]],
      ['readDocument', [target], [target]],
      ['createDocument', [{ kind: 'canvas', container: { kind: 'user' } }], [{ kind: 'canvas', container: { kind: 'user' } }]],
      ['saveDocument', [{ target, expectedRevision: 3, content: { a: 1 } }], [{ target, expectedRevision: 3, content: { a: 1 } }]],
      ['renameDocument', [{ target, name: '新名' }], [{ target, name: '新名' }]],
      ['finalizeDocument', [{ target, name: '新名', folder: '/elsewhere' }], [{ target, name: '新名', folder: '/elsewhere' }]],
      ['moveDocument', [{ target, container: { kind: 'user' }, onConflict: 'keepBoth' }], [{ target, container: { kind: 'user' }, onConflict: 'keepBoth' }]],
      ['duplicateDocument', [{ target }], [{ target }]],
      ['trashDocument', [target], [target]],
      ['deleteEmptyDraft', [target], [target]],
      ['forgetDocument', ['doc-1'], ['doc-1']],
      ['revealDocument', [target], [target]],
      ['resolveDocumentLink', [{ docId: 'doc-1', path: '/work/a.henji-canvas' }], [{ docId: 'doc-1', path: '/work/a.henji-canvas' }]],
      ['checkName', [{ subject: { type: 'project' }, name: 'x', location: { container: { kind: 'user' } } }], [{ subject: { type: 'project' }, name: 'x', location: { container: { kind: 'user' } } }]],
      ['getDocumentCover', ['doc-1'], ['doc-1']],
      ['saveDocumentCover', [{ docId: 'doc-1', sources: [{ source: 'a.png', sourceKind: 'image' }] }], [{ docId: 'doc-1', sources: [{ source: 'a.png', sourceKind: 'image' }] }]],
      ['refreshIndex', [], []],
      ['readSessionState', [{ docId: 'doc-1', key: 'canvas.viewport' }], [{ docId: 'doc-1', key: 'canvas.viewport' }]],
      ['writeSessionState', [{ docId: 'doc-1', key: 'canvas.viewport', value: { x: 1 } }], [{ docId: 'doc-1', key: 'canvas.viewport', value: { x: 1 } }]],
      ['listProjects', [undefined], [{}]],
      ['listProjectsPage', [{ pageSize: 17 }], [{ pageSize: 17 }]],
      ['createProject', [undefined], [{}]],
      ['renameProject', [{ projectId: 'p1', name: '新' }], [{ projectId: 'p1', name: '新' }]],
      ['finalizeProject', [{ projectId: 'p1', name: '新', parentFolder: '/elsewhere' }], [{ projectId: 'p1', name: '新', parentFolder: '/elsewhere' }]],
      ['trashProject', ['p1'], ['p1']],
      ['registerExternalProject', ['/elsewhere/p'], ['/elsewhere/p']],
      ['registerExternalDocument', ['/elsewhere/a.henjiimg'], ['/elsewhere/a.henjiimg']],
      ['forgetExternalLocation', ['/elsewhere/p'], ['/elsewhere/p']],
      ['revealProject', ['p1'], ['p1']],
      ['exportDocumentPackage', [{ target }], [{ target }]],
      ['exportProjectPackage', [{ projectId: 'p1', destination: '/elsewhere/p.henjipack' }], [{ projectId: 'p1', destination: '/elsewhere/p.henjipack' }]],
      ['importPackage', [{ source: '/elsewhere/p.henjipack', container: { kind: 'project', projectId: 'p1' } }], [{ source: '/elsewhere/p.henjipack', container: { kind: 'project', projectId: 'p1' } }]],
    ]
    for (const [method, args, expected] of calls) {
      const call = bridge[method] as (...values: unknown[]) => Promise<unknown>
      await expect(call(...args)).resolves.toBe(method)
      expect(mock.service[method]).toHaveBeenLastCalledWith(...expected)
    }
    expect(new Set(calls.map(([method]) => method))).toEqual(new Set(METHODS))
  })

  it('非法参数在主进程入口被拒绝，不会到达服务', async () => {
    const bridge = api()
    await expect(bridge.saveDocument({ target: { id: 'doc-1' }, expectedRevision: 0 } as never)).rejects.toThrow()
    await expect(bridge.createDocument({ kind: 'unknown', container: { kind: 'user' } } as never)).rejects.toThrow()
    await expect(bridge.readDocument({ id: '../escape' })).rejects.toThrow()
    await expect(bridge.trashProject('')).rejects.toThrow()
    await expect(bridge.moveDocument({ target: { id: 'a' }, container: { kind: 'project' } } as never)).rejects.toThrow()
    await expect(bridge.saveDocumentCover({ docId: 'a', sources: [] })).rejects.toThrow()
    await expect(bridge.readSessionState({ docId: 'a', key: '../escape' })).rejects.toThrow()
    for (const method of ['saveDocument', 'createDocument', 'readDocument', 'trashProject', 'moveDocument', 'saveDocumentCover', 'readSessionState'] as const) {
      expect(mock.service[method]).not.toHaveBeenCalled()
    }
  })
})
