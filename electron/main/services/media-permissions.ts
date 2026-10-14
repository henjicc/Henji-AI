import { desktopCapturer, session, shell, systemPreferences, webContents, type Session, type WebContents } from 'electron'
import { release } from 'node:os'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import type { CaptureKind, CapturePermissionStatus, CaptureSelection, CaptureSource } from '../../../src/core/screenRecording/contracts'
import { createMainLogger } from './logging'

interface CaptureGrant { kinds: ReadonlySet<CaptureKind>; selection?: CaptureSelection }
const logger = createMainLogger('main.media_permissions')
const clipboardPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read'])

/** 唯一权限入口。grant 归属 webContents + 捕获会话；撤销一个会话不影响其他会话。 */
export class MediaPermissionService {
  private readonly grants = new Map<Session, Map<number, Map<string, CaptureGrant>>>()
  private readonly installed = new WeakSet<Session>()
  private readonly watched = new WeakSet<WebContents>()
  private readonly protectedSourceIds = new Set<string>()

  protectSource(id: string): () => void {
    this.protectedSourceIds.add(id)
    return () => { this.protectedSourceIds.delete(id) }
  }

  install(target: Session): void {
    if (this.installed.has(target)) return
    this.installed.add(target)
    target.setPermissionCheckHandler((contents, permission, _origin, details) => {
      if (!contents || !isTrustedMainRendererUrl(contents.getURL())) return false
      if (details.isMainFrame === false) return false
      if (details.requestingUrl && !isTrustedMainRendererUrl(details.requestingUrl)) return false
      if (clipboardPermissions.has(permission)) return true
      // display-capture 在公开 Session 契约中存在，Electron 42 的 Check 类型枚举未列出它。
      if (String(permission) === 'display-capture') return this.has(contents, 'screen')
      const allowed = permission === 'media' && (details.mediaType === 'audio' ? this.has(contents, 'microphone') : details.mediaType === 'video' && this.has(contents, 'camera'))
      if (!allowed) logger.info('采集权限检查未放行', { event: 'media.permission.check.denied', context: { permission, mediaType: details.mediaType ?? 'none', mainFrame: details.isMainFrame } })
      return allowed
    })
    target.setPermissionRequestHandler((contents, permission, callback, details) => {
      const trusted = isTrustedMainRendererUrl(contents.getURL()) && details.isMainFrame
        && (!details.requestingUrl || isTrustedMainRendererUrl(details.requestingUrl))
      const kinds = 'mediaTypes' in details ? details.mediaTypes : undefined
      const allowed = trusted && (clipboardPermissions.has(permission)
        || permission === 'display-capture' && this.has(contents, 'screen')
        // Electron 42 把 getDisplayMedia 也作为 media 请求发送，mediaTypes 为空；
        // 只在已准备屏幕采集时放行，随后 Display handler 再核对预选来源和声音。
        || permission === 'media' && kinds?.length === 0 && this.has(contents, 'screen')
        || permission === 'media' && Boolean(kinds?.length) && kinds!.every(kind => kind === 'audio' ? this.has(contents, 'microphone') : kind === 'video' && this.has(contents, 'camera')))
      if (!allowed) logger.info('采集权限请求未放行', { event: 'media.permission.request.denied', context: { permission, mediaTypes: kinds ?? [], mainFrame: details.isMainFrame } })
      callback(allowed)
    })
    target.setDisplayMediaRequestHandler((request, callback) => {
      const frame = request.frame
      const contents = frame ? webContents.fromFrame(frame) : null
      if (!frame || frame !== frame.top || !contents || contents.session !== target || !isTrustedMainRendererUrl(frame.url)) { callback({}); return }
      const candidates = [...(this.grants.get(target)?.get(contents.id)?.values() ?? [])].filter(grant => grant.kinds.has('screen') && grant.selection)
      // Ambiguous concurrent selections must not silently capture the wrong target.
      if (candidates.length !== 1 || !request.videoRequested) { callback({}); return }
      const grant = candidates[0]
      if (request.audioRequested && !grant.kinds.has('systemAudio')) { callback({}); return }
      void this.sources(grant.selection!.excludedSourceIds).then(sources => {
        const stillOwned = [...(this.grants.get(target)?.get(contents.id)?.values() ?? [])].includes(grant)
        const source = sources.find(item => item.id === grant.selection!.sourceId)
        if (!stillOwned || contents.isDestroyed() || frame.isDestroyed() || !isTrustedMainRendererUrl(frame.url) || !source) { callback({}); return }
        callback({ video: source, ...(request.audioRequested ? { audio: 'loopback' } : {}) })
        logger.info('屏幕采集权限已授予', { event: 'media.permission.display.granted', context: { kind: source.kind, systemAudio: request.audioRequested } })
      }).catch(error => {
        logger.warn('屏幕采集选源失败', { event: 'media.permission.display.failed', error })
        callback({})
      })
    }, { useSystemPicker: false })
  }

  grant(contents: WebContents, captureSession: string, kinds: readonly CaptureKind[], selection?: CaptureSelection): void {
    if (!isTrustedMainRendererUrl(contents.getURL())) throw new Error('只能为痕迹AI的采集窗口授予权限')
    const target = contents.session ?? session.defaultSession
    this.install(target)
    if (kinds.includes('screen') && !selection) throw new Error('请先选择要录制的屏幕或窗口')
    if (kinds.includes('systemAudio') && !kinds.includes('screen')) throw new Error('系统声音必须与已选定的屏幕采集一起授权')
    if (selection?.excludedSourceIds.includes(selection.sourceId)) throw new Error('所选窗口已被排除，请重新选择录制来源')
    // Chromium cannot mask arbitrary windows inside a screen stream.
    if (selection?.sourceId.startsWith('screen:') && selection.excludedSourceIds.length) throw new Error('排除窗口时请改为录制指定窗口；整屏录制无法隐藏其他应用窗口')
    const windows = this.grants.get(target) ?? new Map<number, Map<string, CaptureGrant>>()
    const leases = windows.get(contents.id) ?? new Map<string, CaptureGrant>()
    leases.set(captureSession, { kinds: new Set(kinds), ...(selection ? { selection: structuredClone(selection) } : {}) })
    windows.set(contents.id, leases); this.grants.set(target, windows)
    if (!this.watched.has(contents)) {
      this.watched.add(contents)
      contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame !== false) this.revokeWindow(contents) })
      contents.on('render-process-gone', () => this.revokeWindow(contents))
      contents.once('destroyed', () => this.revokeWindow(contents))
    }
    logger.info('采集会话权限已登记', { event: 'media.permission.granted', context: { kinds } })
  }

  revoke(contents: WebContents, captureSession: string): void {
    const windows = this.grants.get(contents.session ?? session.defaultSession)
    windows?.get(contents.id)?.delete(captureSession)
    if (!windows?.get(contents.id)?.size) windows?.delete(contents.id)
    logger.info('采集会话权限已撤销', { event: 'media.permission.revoked' })
  }

  revokeWindow(contents: WebContents): void { this.grants.get(contents.session ?? session.defaultSession)?.delete(contents.id) }
  /** Native WGC must obey the same session-scoped grant as getDisplayMedia. */
  assertSelection(contents: WebContents, sessionId: string, sourceId: string): void {
    const grant = this.grants.get(contents.session ?? session.defaultSession)?.get(contents.id)?.get(sessionId)
    if (contents.isDestroyed() || !isTrustedMainRendererUrl(contents.getURL()) || !grant?.kinds.has('screen') || grant.selection?.sourceId !== sourceId || this.protectedSourceIds.has(sourceId)) throw new Error('屏幕采集授权已失效，请重新选择并确认录制来源')
  }
  private has(contents: WebContents, kind: CaptureKind): boolean {
    return [...(this.grants.get(contents.session ?? session.defaultSession)?.get(contents.id)?.values() ?? [])].some(grant => grant.kinds.has(kind))
  }

  async sources(excludedSourceIds: readonly string[] = []): Promise<CaptureSource[]> {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false })
    return sources.filter(source => !this.protectedSourceIds.has(source.id) && !excludedSourceIds.includes(source.id)).map(source => ({ id: source.id, name: source.name, kind: source.id.startsWith('screen:') ? 'screen' : 'window', displayId: source.display_id, ...(source.thumbnail && !source.thumbnail.isEmpty() ? { thumbnailUrl: source.thumbnail.toDataURL() } : {}) }))
  }

  statuses(platform: NodeJS.Platform = process.platform, systemRelease: string = release()): CapturePermissionStatus[] {
    return (['microphone', 'camera', 'screen', 'systemAudio'] as const).map(kind => {
      if (kind === 'systemAudio') {
        const [major, minor] = systemRelease.split('.').map(Number)
        const macTap = platform === 'darwin' && (major > 23 || major === 23 && minor >= 2)
        return { kind, status: platform === 'win32' ? 'granted' : macTap ? 'unknown' : 'unsupported', recovery: 'none' }
      }
      const status = platform === 'darwin' || platform === 'win32' && kind !== 'screen' ? systemPreferences.getMediaAccessStatus(kind) : 'granted'
      return { kind, status, recovery: status === 'denied' || status === 'restricted' ? 'system-settings' : status === 'not-determined' ? 'request' : 'none' }
    })
  }

  async requestAccess(kinds: readonly CaptureKind[], platform: NodeJS.Platform = process.platform, systemRelease: string = release()): Promise<void> {
    for (const kind of kinds) {
      let status = this.statuses(platform, systemRelease).find(item => item.kind === kind)!
      if (platform === 'darwin' && (kind === 'microphone' || kind === 'camera') && status.status === 'not-determined') {
        const granted = await systemPreferences.askForMediaAccess(kind)
        status = { kind, status: granted ? 'granted' : 'denied', recovery: granted ? 'none' : 'system-settings' }
      }
      if (status.status === 'denied' || status.status === 'restricted') throw new Error(`${kind === 'microphone' ? '麦克风' : kind === 'camera' ? '摄像头' : '屏幕录制'}未获授权，请在系统设置中允许痕迹AI访问，然后重试；屏幕权限变更后可能需要重启应用`)
      if (status.status === 'unsupported') throw new Error('当前系统声音采集路径不可用，请关闭系统声音后重试')
    }
  }

  async openSettings(kind: CaptureKind): Promise<void> {
    const pane = kind === 'microphone' ? 'Microphone' : kind === 'camera' ? 'Camera' : 'ScreenCapture'
    if (process.platform === 'darwin') await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`)
    else if (process.platform === 'win32') {
      if (kind === 'screen' || kind === 'systemAudio') throw new Error('此采集类型无需系统隐私开关，请重新选择录制来源后重试')
      await shell.openExternal(kind === 'camera' ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone')
    }
    else throw new Error('请在系统设置中检查采集权限')
  }
}

export const mediaPermissions = new MediaPermissionService()
