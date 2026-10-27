import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import type { ElementInfoValue, WebRecordingBehaviorEvent } from '../../../../../src/core/webReplay/schema'
import type { WebRecordingStore } from '../store'

const BUTTONS = ['left', 'middle', 'right', 'back', 'forward'] as const
type Cdp = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/**
 * Turns behavior events into trusted browser input through the DevTools protocol. Presses and
 * wheel go to the element the recording named (its current position plus the in-element
 * offset); moves keep their recorded path. The pointer position is tracked for later presses.
 * A director script's input comes through the same path: `moveTo` (rewritten pointer paths),
 * `insertText` (typing one character at a time), and events without a target at a given point.
 */
export class InputDispatcher {
  private x = 0
  private y = 0
  private buttons = 0
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
        if (event.type === 'move') { this.buttons = event.buttons; await this.move(event.x, event.y, event.mods); return { x: event.x, y: event.y } }
        const point = await this.pointFor(event.target, event)
        if (Math.abs(point.x - this.x) > 0.5 || Math.abs(point.y - this.y) > 0.5) await this.move(point.x, point.y, event.mods)
        this.buttons = event.buttons
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
        const printable = event.key.length === 1 && !(event.mods & (2 | 4))
        const base = { key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode, location: event.location, autoRepeat: event.repeat, modifiers: event.mods }
        if (event.type === 'up') await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
        else if (printable) await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: event.key, unmodifiedText: event.key })
        else await this.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, ...(event.key === 'Enter' ? { text: '\r' } : {}) })
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
