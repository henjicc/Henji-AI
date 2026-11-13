import { beforeEach, expect, it, vi } from 'vitest'
import type { SharedTextureImported, WebFrameMain } from 'electron'

vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
import { CapturePreview } from './preview'

const reply = { format: 'bgra', codedSize: { width: 1920, height: 1080 }, keyedMutex: false, slots: ['100', '104', '108'], fps: 30 }
let requests: Array<{ type: string; payload: Record<string, unknown> }>, released: Array<() => void>, imports: Array<{ handle: Buffer; slot: number }>, sends: unknown[]
let failImport: boolean, closeFails = false, deferStart: boolean, pending: ((value: unknown) => void) | undefined
const target = { isDestroyed: () => false, mainFrame: {} as WebFrameMain }
function preview(): CapturePreview {
  return new CapturePreview({
    sessionId: () => 's',
    request: async (type, payload) => {
      requests.push({ type, payload })
      if (type === 'closeClientHandles' && closeFails) throw new Error('画面采集服务已退出')
      if (type === 'startPreview' && !deferStart) return reply
      if (type === 'startPreview') return new Promise(resolve => { pending = resolve })
      return {}
    },
    sharedTexture: {
      importSharedTexture: options => {
        if (failImport) throw new Error('导入失败')
        const handle = (options.textureInfo.handle as { ntHandle: Buffer }).ntHandle
        imports.push({ handle, slot: reply.slots.indexOf(String(handle.readBigUInt64LE())) })
        released.push(options.allReferencesReleased!)
        return { release: vi.fn(), getVideoFrame: vi.fn(), subtle: {} } as unknown as SharedTextureImported
      },
      sendSharedTexture: async (_options, meta) => { sends.push(meta) },
    },
  })
}
beforeEach(() => { requests = []; released = []; imports = []; sends = []; failImport = false; deferStart = false; pending = undefined })

it('开预览要的是主进程自己的句柄；画好一张导入那个槽位、按页面的通道送去；还被占着的槽位跳过', async () => {
  const live = preview()
  await expect(live.open(target, 'vf-route-3', true)).resolves.toEqual({ width: 1920, height: 1080 })
  expect(requests[0]).toEqual({ type: 'startPreview', payload: expect.objectContaining({ sessionId: 's', clientPid: process.pid }) })
  live.frame({ slot: 1, sequence: 1, sourceUs: 5 })
  live.frame({ slot: 1, sequence: 4, sourceUs: 9 })
  expect(imports.map(item => item.slot)).toEqual([1])
  await Promise.resolve()
  expect(sends).toEqual([expect.objectContaining({ route: 'vf-route-3', frameIndex: 1, timestampUs: 5 })])
  released[0]()
  live.frame({ slot: 1, sequence: 7, sourceUs: 12 })
  expect(imports.map(item => item.slot)).toEqual([1, 1])
})

it('结束时先停止导入，再要采集进程关掉主进程里的句柄；导入出错只停预览；关句柄没有确认时不重关', async () => {
  const live = preview()
  await live.open(target, 'r', true)
  live.end()
  live.frame({ slot: 0, sequence: 1, sourceUs: 1 })
  expect(imports).toHaveLength(0)
  expect(requests.at(-1)).toEqual({ type: 'closeClientHandles', payload: { clientPid: process.pid, handles: reply.slots } })

  await live.open(target, 'r', true)
  failImport = true
  live.frame({ slot: 0, sequence: 2, sourceUs: 2 })
  await vi.waitFor(() => expect(requests.at(-1)?.type).toBe('stopPreview'))
  failImport = false
  live.frame({ slot: 1, sequence: 3, sourceUs: 3 })
  expect(imports).toHaveLength(0)

  closeFails = true
  await live.open(target, 'r', true)
  live.end()
  await vi.waitFor(() => expect(requests.at(-1)?.type).toBe('closeClientHandles'))
  closeFails = false
  // 句柄值会被重用：下一批关的只有它自己的句柄，不带上一批没确认的。
  await live.open(target, 'r', true)
  live.end()
  await vi.waitFor(() => expect(requests.filter(item => item.type === 'closeClientHandles').at(-1)?.payload.handles).toEqual(reply.slots))
})

it('开预览的应答回来前已经关了：不认这次的句柄；采集还没准备好时只记下，续录后再开', async () => {
  const live = preview()
  deferStart = true
  const opening = live.open(target, 'r', true)
  await live.close()
  pending!(reply)
  await expect(opening).resolves.toBeNull()
  live.frame({ slot: 0, sequence: 1, sourceUs: 1 })
  expect(imports).toHaveLength(0)
  // 迟到的那批句柄没用上，照样关掉。
  expect(requests.map(item => item.type)).toEqual(['startPreview', 'stopPreview', 'closeClientHandles'])

  deferStart = false
  await expect(live.open(target, 'r', false)).resolves.toBeNull()
  expect(requests).toHaveLength(3)
  live.resume()
  await vi.waitFor(() => expect(requests.at(-1)?.type).toBe('startPreview'))
  await Promise.resolve()
  live.frame({ slot: 2, sequence: 1, sourceUs: 1 })
  expect(imports.map(item => item.slot)).toEqual([2])
})
