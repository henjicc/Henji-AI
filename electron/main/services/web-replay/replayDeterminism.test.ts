import vm from 'node:vm'
import { MessageChannel } from 'node:worker_threads'
import { createRequire } from 'node:module'
import path from 'node:path'
import { rollup } from 'rollup'
import { expect, it } from 'vitest'
import { replayMainWorld } from '../../../../scripts/vite/replayMainWorld'
import { parseWebReplayDirector } from '../../../../src/core/webReplay/director'
import { planWebReplay } from '../../../../src/core/webReplay/directorPlan'
import type { WebRecordingBehaviorEvent } from '../../../../src/core/webReplay/schema'
import type { ReplayControl } from '../../../../packages/web-replay-probe/src/replay/types'

const { JSDOM } = createRequire(path.resolve('package.json'))('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: { eval(code: string): unknown; close(): void } }
}

it('含惯性拖动和滚轮缩放的页面，在恒速、变速、剪掉区间与不同输出帧率下状态一致', async () => {
  const bundle = await rollup({ input: 'virtual:henji-replay-main-world', plugins: [replayMainWorld()] })
  const { output } = await bundle.generate({ format: 'cjs' })
  await bundle.close()
  const chunk = output.find(item => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('缺少重演主世界产物')
  const isolated = { module: { exports: undefined as unknown } }
  vm.runInNewContext(chunk.code, isolated)
  const install = isolated.module.exports as (host: unknown) => void
  const events: WebRecordingBehaviorEvent[] = [
    { kind: 'pointer', type: 'down', t: 301_000, x: 100, y: 100, buttons: 1, button: 0, clickCount: 1, pointerType: 'mouse', mods: 0 },
    ...Array.from({ length: 18 }, (_, i): WebRecordingBehaviorEvent => ({ kind: 'pointer', type: 'move', t: 309_000 + i * 19_000, x: 110 + i * 13, y: 110 + i * 4, buttons: 1, button: -1, clickCount: 0, pointerType: 'mouse', mods: 0 })),
    { kind: 'pointer', type: 'up', t: 641_000, x: 331, y: 178, buttons: 0, button: 0, clickCount: 1, pointerType: 'mouse', mods: 0 },
    ...[711_000, 715_000, 731_000, 733_333, 799_000, 801_000, 821_000].map((t): WebRecordingBehaviorEvent => ({ kind: 'wheel', t, x: 300, y: 200, dx: 0, dy: -100, mods: 2 })),
  ]
  const cases = [
    { name: '1x', fps: 60, segments: [{ from: 0, to: 8, speed: 1 }] },
    { name: '4x', fps: 60, segments: [{ from: 0, to: 8, speed: 4 }] },
    { name: '16x', fps: 60, segments: [{ from: 0, to: 8, speed: 16 }] },
    { name: 'ramp-cut', fps: 60, ramp: 0.11, segments: [{ from: 0.137, to: 0.4, speed: 16 }, { from: 0.4, to: 1, speed: 8 }, { from: 1.173, to: 8, speed: 4 }] },
    { name: '4x-24fps', fps: 24, segments: [{ from: 0, to: 8, speed: 4 }] },
  ]
  const states: unknown[] = []
  for (const scenario of cases) {
    const dom = new JSDOM('<!doctype html><html><body><div id="canvas"></div></body></html>', { url: 'https://replay.test/', runScripts: 'outside-only', pretendToBeVisual: true })
    const channels: MessageChannel[] = []
    let painted = 0
    Object.assign(dom.window, { fetch, Headers, Response, Request,
      MessageChannel: class extends MessageChannel { constructor() { super(); channels.push(this) } },
      // 绘制边界由宿主控制；无需真实等待显示器刷新，页面时钟、输入与动画使用正式产物。
      requestAnimationFrame: (callback: (time: number) => void) => { painted++; return setImmediate(() => callback(0)) },
    })
    try {
      dom.window.eval(`performance.now = () => 0; window.Animation = class { get playbackRate() { return 1 } set playbackRate(v) {} get currentTime() { return 0 } set currentTime(v) {} finish() {} }; document.getAnimations = () => []; document.adoptedStyleSheets = []; CSSStyleSheet.prototype.replaceSync = function() {};`)
      const installInPage = dom.window.eval(`(${install.toString()})`) as (host: unknown) => void
      installInPage({ boot: { wallAtZeroMs: 0, random: { math: [], uuid: [], bytes: [] }, clipboard: [], callbacks: [], locator: {}, pointer: false }, report() {} })
      dom.window.eval(`
        let x = 0, y = 0, vx = 0, vy = 0, px = 0, py = 0, lx = 0, ly = 0, zoom = 1, targetZoom = 1, pressed = false, frames = 0;
        const canvas = document.querySelector('#canvas');
        canvas.addEventListener('mousedown', e => { pressed = true; px = lx = e.clientX; py = ly = e.clientY; });
        canvas.addEventListener('mousemove', e => { px = e.clientX; py = e.clientY; });
        canvas.addEventListener('mouseup', () => { pressed = false; });
        canvas.addEventListener('wheel', e => { targetZoom = zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1); });
        function animate() {
          frames++;
          if (pressed) { vx = px - lx; vy = py - ly; lx = px; ly = py; }
          x += vx; y += vy;
          if (!pressed) { vx *= 0.91; vy *= 0.91; }
          zoom += (targetZoom - zoom) * 0.2;
          canvas.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + zoom + ')';
          requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
        window.readState = () => ({ x, y, zoom, frames, transform: canvas.style.transform });
      `)
      const control = dom.window.eval('__HENJI_WEB_REPLAY_CONTROL__') as ReplayControl
      const plan = planWebReplay({ director: parseWebReplayDirector({ version: 1, timeline: { segments: scenario.segments, ramp: scenario.ramp ?? 0 } }), events, totalRecUs: 8_000_000, fps: scenario.fps, viewport: { width: 800, height: 600 } })
      for (const op of plan.ops) {
        if (op.pageUs > 4_000_000) break
        if (op.kind === 'frame') await control.frame(op.pageUs / 1000, { allowQuiet: true, tick: op.tick })
        else if (op.kind === 'advance') await control.tick(op.pageUs / 1000)
        else if (op.kind === 'event') {
          await control.advance(op.pageUs / 1000)
          const event = op.event
          if (event.kind === 'pointer') dom.window.eval(`document.querySelector('#canvas').dispatchEvent(new MouseEvent(${JSON.stringify({ down: 'mousedown', move: 'mousemove', up: 'mouseup' }[event.type])}, { clientX: ${event.x}, clientY: ${event.y}, buttons: ${event.buttons}, bubbles: true }))`)
          else if (event.kind === 'wheel') dom.window.eval(`document.querySelector('#canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: ${event.dy}, bubbles: true }))`)
        }
      }
      states.push(dom.window.eval('readState()'))
      expect(painted, scenario.name).toBe(plan.ops.filter(op => op.kind === 'frame' && op.pageUs <= 4_000_000).length)
    } finally {
      channels.forEach(channel => { channel.port1.close(); channel.port2.close() })
      dom.window.close()
    }
  }
  expect(states[0]).toMatchObject({ frames: 241, x: 375.44444367520396, y: 122.44444420775515, zoom: 1.2362478923519995 })
  for (let i = 1; i < states.length; i++) expect(states[i], cases[i].name).toEqual(states[0])
}, 15_000)
