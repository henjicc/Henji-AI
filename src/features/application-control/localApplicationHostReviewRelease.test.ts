// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApplicationHostBridge } from '../../../electron/main/services/application-runtime/applicationHostBridge'
import type { ApplicationHostPlatform, LocalHostRequest } from '@/core/application-control/localHostContracts'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { closeVideoEditProject, listVideoEditInstances, openVideoEditDocument } from '@/features/videoEdit/application/videoEditService'
import { getDocumentOperations, getDocumentSessionRegistry } from '@/features/documents'
import { attachLocalApplicationHost } from './localApplicationHost'

vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class {
  async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } async computeDuration() { return 0 } dispose() {}
} }))
beforeEach(() => {
  installHarnessNativeStorage()
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20 } } } } })
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

/** 只替换 IPC 边界：主进程宿主桥与渲染层宿主都是正式实现。beforeComplete 在渲染层送回回复之前执行，仍在这次请求之内。 */
function host(beforeComplete: (count: number) => Promise<unknown> | void = () => undefined) {
  const bridge = new ApplicationHostBridge(() => undefined)
  let request: (value: LocalHostRequest) => void = () => undefined
  let completed = 0
  const platform: ApplicationHostPlatform = {
    contentTrust: async () => { throw new Error('此用例不调用代码信任存储') }, onContentTrust: () => () => {},
    registerHost: async registration => { bridge.register(registration, { send: (_channel, payload) => request(payload as LocalHostRequest) }) },
    complete: async reply => { await beforeComplete(++completed); bridge.complete(reply) },
    publishContext: async snapshot => { bridge.publishContext(snapshot) },
    onRequest: callback => { request = callback; return () => undefined },
    reviewOperations: async () => ({ items: [] }), onReviews: () => () => {}, onCancel: () => () => undefined, onRevoke: () => () => undefined,
  }
  return { bridge, dispose: attachLocalApplicationHost(platform, true) }
}

const openIds = () => getDocumentSessionRegistry().list().map(session => session.id).sort()
const exists = (...ids: string[]) => ({ conditions: ids.map(id => ({ kind: 'entity_exists' as const, target: { kind: 'video_edit.document', id } })), evidence: [] })
async function closedProject(): Promise<string> {
  const instance = await createVideoEditTestProject()
  await closeVideoEditProject(instance.document.id)
  return instance.document.id
}
/** 等释放都结束后返回请求释放的文档。 */
async function releasedIds(release: { mock: { calls: Array<[unknown, string]>; results: Array<{ value: unknown }> } }): Promise<string[]> {
  await vi.waitFor(() => expect(release).toHaveBeenCalled())
  await Promise.all(release.mock.results.map(result => result.value))
  return release.mock.calls.map(call => call[1])
}

it('核对重读验证在后台打开的剪辑读完即释放，用户开着的剪辑照常开着', async () => {
  const closed = await createVideoEditTestProject()
  await closeVideoEditProject(closed.document.id)
  const shown = await createVideoEditTestProject()
  const before = openIds()
  expect(before).toEqual([shown.document.id])
  const { bridge, dispose } = host()
  try {
    await vi.waitFor(() => expect(bridge.ready).toBe(true))
    const result = await bridge.execute(crypto.randomUUID(), 'get_current_application_context', {}, new AbortController().signal, { recoveryVerification: {
      conditions: [closed.document.id, shown.document.id].map(id => ({ kind: 'entity_exists' as const, target: { kind: 'video_edit.document', id } })), evidence: [] } })
    expect(result).toMatchObject({ ok: true, data: { verification: { verified: true } } })
    await vi.waitFor(() => expect(openIds()).toEqual(before))
    expect(listVideoEditInstances().map(instance => instance.document.id)).toEqual([shown.document.id])
    expect(shown.session.isEnded).toBe(false)
  } finally { dispose() }
})

it('核对读取期间用户在界面上打开的别的文档不算读取打开的，不释放', async () => {
  const target = await closedProject(), other = await closedProject()
  // 用户这时打开另一份文档，还没显示出来（图片文档加载期间就是这样）。
  const { bridge, dispose } = host(count => count === 1 ? openVideoEditDocument({ id: other }, { focus: false }) : undefined)
  const release = vi.spyOn(getDocumentOperations(), 'releaseBackground')
  try {
    await vi.waitFor(() => expect(bridge.ready).toBe(true))
    await bridge.execute(crypto.randomUUID(), 'get_current_application_context', {}, new AbortController().signal, { recoveryVerification: exists(target) })
    expect(await releasedIds(release)).toEqual([target])
    expect(openIds()).toEqual([other])
  } finally { dispose() }
})

it('逐个释放途中来了新的宿主请求就停下，剩下的会话留着', async () => {
  const first = await closedProject(), second = await closedProject()
  let resume!: () => void
  const held = new Promise<void>(resolve => { resume = resolve })
  // 第二次回复属于释放途中来的读取，先压住，让它在释放检查时仍在执行。
  const { bridge, dispose } = host(count => count === 2 ? held : undefined)
  const operations = getDocumentOperations()
  const original = operations.releaseBackground.bind(operations)
  let read: Promise<unknown> | undefined
  const release = vi.spyOn(operations, 'releaseBackground').mockImplementation(async (kind, id) => {
    read ??= bridge.execute(crypto.randomUUID(), 'get_current_application_context', {}, new AbortController().signal)
    return await original(kind, id)
  })
  try {
    await vi.waitFor(() => expect(bridge.ready).toBe(true))
    await bridge.execute(crypto.randomUUID(), 'get_current_application_context', {}, new AbortController().signal, { recoveryVerification: exists(first, second) })
    expect(await releasedIds(release)).toEqual([first])
    expect(openIds()).toEqual([second])
  } finally { resume(); await read; dispose() }
})
