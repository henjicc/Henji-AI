import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, WebContents } from 'electron'
import { MediaPermissionService } from './media-permissions'

type Check = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>
type Request = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>
type Display = NonNullable<Parameters<Session['setDisplayMediaRequestHandler']>[0]>
const mocks = vi.hoisted(() => ({ sources: vi.fn(), status: vi.fn(), ask: vi.fn(), fromFrame: vi.fn(), open: vi.fn() }))
vi.mock('electron', () => ({ desktopCapturer: { getSources: mocks.sources }, systemPreferences: { getMediaAccessStatus: mocks.status, askForMediaAccess: mocks.ask }, shell: { openExternal: mocks.open }, webContents: { fromFrame: mocks.fromFrame }, session: {} }))
vi.mock('../security/main-renderer-url', () => ({ isTrustedMainRendererUrl: (url: string) => url === 'app://henji' }))
vi.mock('./logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))

function fixture(): { service: MediaPermissionService; target: Session; contents: WebContents; hooks: { check: Check; request: Request; display: Display } } {
  const hooks = {} as { check: Check; request: Request; display: Display }
  const target = { setPermissionCheckHandler: vi.fn((fn: Check) => { hooks.check = fn }), setPermissionRequestHandler: vi.fn((fn: Request) => { hooks.request = fn }), setDisplayMediaRequestHandler: vi.fn((fn: Display) => { hooks.display = fn }) } as unknown as Session
  const contents = Object.assign(new EventEmitter(), { id: 1, session: target, getURL: () => 'app://henji', isDestroyed: () => false }) as unknown as WebContents
  const service = new MediaPermissionService(); service.install(target)
  return { service, target, contents, hooks }
}
beforeEach(() => { vi.clearAllMocks(); mocks.sources.mockResolvedValue([{ id: 'window:42:0', name: '编辑器', display_id: '' }, { id: 'screen:0:0', name: '屏幕', display_id: '1' }]); mocks.status.mockReturnValue('granted') })

describe('统一媒体权限', () => {
  it('未登记拒绝、会话类型最小放行、撤销隔离且不覆盖已安装处理器', () => {
    const { service, target, contents, hooks } = fixture()
    const check = (kind: 'audio' | 'video'): boolean => hooks.check(contents, 'media', '', { mediaType: kind, securityOrigin: 'app://henji', isMainFrame: true })
    expect(check('audio')).toBe(false)
    service.grant(contents, 'explanation', ['microphone'])
    service.install(target)
    expect(target.setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(check('audio')).toBe(true); expect(check('video')).toBe(false)
    service.grant(contents, 'recording', ['camera'])
    expect(check('video')).toBe(true)
    service.revoke(contents, 'recording')
    expect(check('video')).toBe(false); expect(check('audio')).toBe(true)
    service.revoke(contents, 'explanation'); expect(check('audio')).toBe(false)
  })
  it('混合请求要求全部授权，子frame与外部来源均拒绝', () => {
    const { service, contents, hooks } = fixture()
    service.grant(contents, 'mic', ['microphone'])
    const decide = (details: object): boolean => { let granted = false; hooks.request(contents, 'media', answer => { granted = answer }, details as Parameters<Request>[3]); return granted }
    expect(decide({ isMainFrame: true, mediaTypes: ['audio'] })).toBe(true)
    expect(decide({ isMainFrame: true, mediaTypes: ['audio', 'video'] })).toBe(false)
    service.grant(contents, 'cam', ['camera'])
    expect(decide({ isMainFrame: true, mediaTypes: ['audio', 'video'] })).toBe(true)
    expect(decide({ isMainFrame: false, mediaTypes: ['audio'] })).toBe(false)
    expect(decide({ isMainFrame: true, requestingUrl: 'https://other', mediaTypes: ['audio'] })).toBe(false)
    expect(decide({ isMainFrame: true, mediaTypes: [] })).toBe(false)
    contents.emit('did-start-navigation', {}, '', false, false)
    expect(decide({ isMainFrame: true, mediaTypes: ['audio'] })).toBe(true)
    contents.emit('did-start-navigation', {}, '', false, true)
    expect(decide({ isMainFrame: true, mediaTypes: ['audio'] })).toBe(false)
  })
  it.each(['destroyed', 'render-process-gone'])('%s 立即撤销，其他窗口和会话不受影响', event => {
    const { service, contents, target, hooks } = fixture()
    const other = Object.assign(new EventEmitter(), { id: 2, session: target, getURL: () => 'app://henji' }) as unknown as WebContents
    service.grant(contents, 'mic', ['microphone']); service.grant(other, 'mic', ['microphone'])
    contents.emit(event)
    expect(hooks.check(contents, 'media', '', { mediaType: 'audio', securityOrigin: '', isMainFrame: true })).toBe(false)
    expect(hooks.check(other, 'media', '', { mediaType: 'audio', securityOrigin: '', isMainFrame: true })).toBe(true)
  })
  it('会话隔离，无屏幕授权拒绝选源；只返回预选来源与知情系统声音', async () => {
    const { service, contents, hooks } = fixture()
    const frame = { url: 'app://henji', isDestroyed: () => false } as unknown as NonNullable<Parameters<Display>[0]['frame']>
    Object.assign(frame, { top: frame }); mocks.fromFrame.mockReturnValue(contents)
    const request = { frame, videoRequested: true, audioRequested: true, securityOrigin: 'app://henji', userGesture: true }
    const response = (): Promise<Parameters<Parameters<Display>[1]>[0]> => new Promise(resolve => hooks.display(request, resolve))
    expect(await response()).toEqual({})
    service.grant(contents, 'screen', ['screen'], { sourceId: 'window:42:0', excludedSourceIds: [] })
    expect(hooks.check(contents, 'display-capture' as Parameters<Check>[1], '', { isMainFrame: true })).toBe(true)
    expect(hooks.check(contents, 'media', '', { mediaType: 'video', isMainFrame: true })).toBe(false)
    let allowed = false
    hooks.request(contents, 'media', answer => { allowed = answer }, { isMainFrame: true, requestingUrl: 'app://henji', mediaTypes: [] })
    expect(allowed).toBe(true)
    hooks.request(contents, 'media', answer => { allowed = answer }, { isMainFrame: true, requestingUrl: 'app://henji', mediaTypes: ['video'] })
    expect(allowed).toBe(false)
    expect(await response()).toEqual({})
    service.grant(contents, 'screen', ['screen', 'systemAudio'], { sourceId: 'window:42:0', excludedSourceIds: [] })
    expect(await response()).toMatchObject({ video: { id: 'window:42:0' }, audio: 'loopback' })
    service.revoke(contents, 'screen'); expect(await response()).toEqual({})
    expect(hooks.check(contents, 'display-capture' as Parameters<Check>[1], '', { isMainFrame: true })).toBe(false)
    hooks.request(contents, 'media', answer => { allowed = answer }, { isMainFrame: true, requestingUrl: 'app://henji', mediaTypes: [] })
    expect(allowed).toBe(false)
  })
  it('选源等待中撤销、来源消失、排除及枚举失败都拒绝，绝不退回首个来源', async () => {
    const { service, contents, hooks } = fixture()
    const frame = { url: 'app://henji', isDestroyed: () => false } as unknown as NonNullable<Parameters<Display>[0]['frame']>
    Object.assign(frame, { top: frame }); mocks.fromFrame.mockReturnValue(contents)
    const request = { frame, videoRequested: true, audioRequested: false, securityOrigin: 'app://henji', userGesture: true }
    service.grant(contents, 'screen', ['screen'], { sourceId: 'window:42:0', excludedSourceIds: [] })
    let finish!: (sources: unknown[]) => void
    mocks.sources.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const result = new Promise(resolve => hooks.display(request, resolve))
    service.revoke(contents, 'screen'); finish([{ id: 'window:42:0', name: '编辑器', display_id: '' }])
    expect(await result).toEqual({})
    service.grant(contents, 'screen', ['screen'], { sourceId: 'window:99:0', excludedSourceIds: [] })
    expect(await new Promise(resolve => hooks.display(request, resolve))).toEqual({})
    expect(() => service.grant(contents, 'screen', ['screen'], { sourceId: 'window:42:0', excludedSourceIds: ['window:42:0'] })).toThrow('已被排除')
    expect(() => service.grant(contents, 'screen', ['screen'], { sourceId: 'screen:0:0', excludedSourceIds: ['window:42:0'] })).toThrow('整屏录制无法隐藏')
    expect(await service.sources(['window:42:0'])).toEqual([{ id: 'screen:0:0', name: '屏幕', kind: 'screen', displayId: '1' }])
    mocks.sources.mockRejectedValueOnce(new Error('device gone'))
    expect(await new Promise(resolve => hooks.display(request, resolve))).toEqual({})
  })
  it('macOS 拒绝有恢复提示，首次麦克风申请与系统声音不支持均如实处理', async () => {
    const { service } = fixture()
    mocks.status.mockReturnValue('denied')
    expect(service.statuses('darwin').find(item => item.kind === 'screen')).toMatchObject({ recovery: 'system-settings' })
    await expect(service.requestAccess(['screen'], 'darwin')).rejects.toThrow('系统设置')
    mocks.status.mockReturnValue('not-determined'); mocks.ask.mockResolvedValue(true)
    await service.requestAccess(['microphone', 'camera'], 'darwin')
    expect(mocks.ask).toHaveBeenCalledWith('microphone'); expect(mocks.ask).toHaveBeenCalledWith('camera')
    mocks.ask.mockResolvedValue(false)
    await expect(service.requestAccess(['microphone'], 'darwin')).rejects.toThrow('未获授权')
    await expect(service.requestAccess(['systemAudio'], 'darwin', '22.0.0')).rejects.toThrow('关闭系统声音')
    expect(service.statuses('darwin', '23.2.0').find(item => item.kind === 'systemAudio')).toMatchObject({ status: 'unknown' })
  })
})
