import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import type { ElementInfoValue, WebRecordingBehaviorEvent } from '../../../../../src/core/webReplay/schema'
import type { WebRecordingStore } from '../store'

const BUTTONS = ['left', 'middle', 'right', 'back', 'forward'] as const
type Cdp = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/**
 * 把行为轨事件经调试协议变成浏览器的可信输入。按下与滚轮落在录制点名的元素上（元素此刻的位置加元素内偏移），
 * 移动沿录制路径；按住期间的移动与松开整体带上按下时的落点偏移（见 held）。导演稿的输入走同一条路：
 * `moveTo`（改写的鼠标路径）、`insertText`（逐字输入），以及没有目标、直接给坐标的事件。
 */
export class InputDispatcher {
  private x = 0
  private y = 0
  private buttons = 0
  /**
   * 按下的落点相对录制坐标的偏移。重演的布局可能和录制差几像素（字形度量不同，整体布局随之移动），按下按元素重新定位后，
   * 按住时的移动与松开都要跟着平移：松开若按录制坐标或松开时碰巧在指针下的元素另算，点击会变成一段拖动，
   * 超过页面的拖动阈值就成了平移画布而不是点击。
   */
  private held = { dx: 0, dy: 0 }
  private tempDir: string | null = null
  misses = 0

  constructor(private readonly contents: WebContents, private readonly cdp: Cdp, private readonly store: WebRecordingStore, private readonly control: string) {}

  private async pointFor(target: ElementInfoValue | undefined, fallback: { x: number; y: number }): Promise<{ x: number; y: number }> {
    if (!target) return fallback
    try {
      const point = await this.contents.executeJavaScript(`window[${JSON.stringify(this.control)}]?.pointFor(${JSON.stringify(target)}) ?? null`) as { x: number; y: number } | null
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return point
    } catch { /* page navigating */ }
    this.misses += 1
    return fallback
  }

  private async move(x: number, y: number, mods: number): Promise<void> {
    this.x = x; this.y = y
    const button = this.buttons & 1 ? 'left' : this.buttons & 4 ? 'middle' : this.buttons & 2 ? 'right' : 'none'
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: mods, buttons: this.buttons, button })
  }

  /** Where the pointer is now (viewport CSS px) and which buttons are held. */
  get position(): { x: number; y: number } { return { x: this.x, y: this.y } }
  get pressed(): number { return this.buttons }

  /** Moves the pointer (buttons stay as they are: a drag keeps dragging). */
  async moveTo(x: number, y: number): Promise<void> { await this.move(x, y, 0) }

  /** Inserts text at the caret as typed input (beforeinput / input of type insertText). */
  async insertText(text: string): Promise<void> { await this.cdp('Input.insertText', { text }) }

  /** Dispatches one event; returns where a pointer, wheel or drop event landed (viewport CSS px). */
  async dispatch(event: WebRecordingBehaviorEvent): Promise<{ x: number; y: number } | null> {
    switch (event.kind) {
      case 'pointer': {
        if (event.type === 'move') {
          this.buttons = event.buttons
          if (!this.buttons) this.held = { dx: 0, dy: 0 }
          const point = { x: event.x + this.held.dx, y: event.y + this.held.dy }
          await this.move(point.x, point.y, event.mods)
          return point
        }
        const holding = this.buttons !== 0
        const point = holding ? { x: event.x + this.held.dx, y: event.y + this.held.dy } : await this.pointFor(event.target, event)
        if (!holding) this.held = { dx: point.x - event.x, dy: point.y - event.y }
        if (Math.abs(point.x - this.x) > 0.5 || Math.abs(point.y - this.y) > 0.5) await this.move(point.x, point.y, event.mods)
        this.buttons = event.buttons
        if (!this.buttons) this.held = { dx: 0, dy: 0 }
        await this.cdp('Input.dispatchMouseEvent', {
          type: event.type === 'down' ? 'mousePressed' : 'mouseReleased', x: point.x, y: point.y, modifiers: event.mods,
          button: BUTTONS[event.button] ?? 'left', buttons: event.buttons, clickCount: Math.max(1, event.clickCount),
        })
        return point
      }
      case 'wheel': {
        const point = await this.pointFor(event.target, event)
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: event.dx, deltaY: event.dy, modifiers: event.mods })
        return point
      }
      case 'key': {
        if (event.composing) return null // the committed text arrives as a `text` event
        // 回车和可打印键一样带字符：表单的隐式提交与文本框换行都发生在 keypress 里，只有带 text 的 keyDown
        // 才会产生 keypress；rawKeyDown 只有 keydown，在输入框里按回车就提交不了表单。
        const text = event.key === 'Enter' ? '\r' : event.key.length === 1 && !(event.mods & (2 | 4)) ? event.key : undefined
        const base = { key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode, location: event.location, autoRepeat: event.repeat, modifiers: event.mods }
        if (event.type === 'up') await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
        else if (text) await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text, unmodifiedText: text })
        else await this.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
        return null
      }
      case 'text': await this.insertText(event.data); return null
      case 'paste': {
        const files = await Promise.all(event.files.map(async f => ({ name: f.name, type: f.type, lastModified: f.lastModified, base64: 'text' in f.body ? Buffer.from(f.body.text).toString('base64') : (await this.store.readBlob(f.body.blob)).toString('base64') })))
        const payload = JSON.stringify({ text: event.text ?? '', html: event.html ?? '', files })
        await this.contents.executeJavaScript(`(() => { const p = ${payload}; const dt = new DataTransfer();
          if (p.text) dt.setData('text/plain', p.text); if (p.html) dt.setData('text/html', p.html);
          for (const f of p.files) { const b = Uint8Array.from(atob(f.base64), c => c.charCodeAt(0)); dt.items.add(new File([b], f.name, { type: f.type, lastModified: f.lastModified })) }
          const target = document.activeElement || document.body;
          const ok = target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
          if (ok && p.text && !p.files.length) document.execCommand('insertText', false, p.text); })()`)
        return null
      }
      case 'drop': {
        const point = await this.pointFor(event.target, event)
        const files = await Promise.all(event.files.map(f => this.tempFile(f.name, f.body)))
        const data = { items: event.text ? [{ mimeType: 'text/plain', data: event.text }] : [], files, dragOperationsMask: 1 }
        for (const type of ['dragEnter', 'dragOver', 'drop']) await this.cdp('Input.dispatchDragEvent', { type, x: point.x, y: point.y, data, modifiers: 0 })
        return point
      }
      case 'resize': return null // handled by the player (window size)
      case 'focus': case 'action': return null
    }
  }

  private async tempFile(name: string, body: { text: string } | { blob: string }): Promise<string> {
    this.tempDir ??= await fs.mkdtemp(path.join(os.tmpdir(), 'henji-web-replay-'))
    const file = path.join(this.tempDir, `${Date.now()}-${path.basename(name) || 'file'}`)
    await fs.writeFile(file, 'text' in body ? Buffer.from(body.text) : await this.store.readBlob(body.blob))
    return file
  }

  async dispose(): Promise<void> { if (this.tempDir) await fs.rm(this.tempDir, { recursive: true, force: true }) }
}
