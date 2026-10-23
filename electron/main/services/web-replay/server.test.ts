import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

const warnings: unknown[] = []
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: (...args: unknown[]) => warnings.push(args) }) }))
vi.mock('../appPaths', () => ({ getUserFolderDir: () => process.env.TEMP ?? '/tmp' }))

const { WebReplayServer } = await import('./server')

const hello = { type: 'hello', protocol: 1, probeVersion: '0.1.0', app: { name: '知多少', version: '0.1.0' }, host: 'tauri', env: { url: 'http://localhost:17631/', viewport: { width: 1280, height: 820, dpr: 1.5 }, colorScheme: 'light', reducedMotion: false, locale: 'zh-CN', timeZone: 'Asia/Shanghai', userAgent: 'test' } }

let server: InstanceType<typeof WebReplayServer> | null = null
afterEach(async () => { await server?.stop(); server = null; warnings.length = 0 })

describe('WebReplayServer', () => {
  it('lists an app after its probe says hello and drops it on disconnect', async () => {
    server = new WebReplayServer(async () => ({ status: 200, contentType: 'image/png', bytes: new Uint8Array() }))
    await server.start(0 as number)
    const port = (server as unknown as { http: { address(): { port: number } } }).http.address().port
    const socket = new WebSocket(`ws://127.0.0.1:${port}/web-replay`)
    await new Promise(resolve => socket.once('open', resolve))
    const changed = new Promise(resolve => server!.once('changed', resolve))
    socket.send(JSON.stringify(hello))
    await changed
    expect(warnings).toEqual([])
    expect(server.apps()).toMatchObject([{ app: { name: '知多少' }, host: 'tauri', recordingId: null }])
    const gone = new Promise(resolve => server!.once('changed', resolve))
    socket.close()
    await gone
    expect(server.apps()).toEqual([])
  })
})
