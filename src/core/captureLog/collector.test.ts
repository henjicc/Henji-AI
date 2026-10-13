import { describe, expect, it, vi } from 'vitest'
import { CaptureLogCollector } from './collector'
import { captureLogPageSchema, type CaptureLogPage } from './events'
import { clockEventIssue } from './clock'
import { captureBounds, capturePoint } from './coordinates'

function fixture(write?: (page: CaptureLogPage) => Promise<void>) {
  const pages: CaptureLogPage[] = []; let id = 0
  const pressure = vi.fn()
  const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id: 'session' }, sourceDigest: `sha256:${'a'.repeat(64)}`, originUs: 10_000, id: () => `id-${id++}` }, write ?? (async page => { pages.push(page) }), pressure)
  return { collector, pages, pressure }
}
describe('共享采集页与录制时钟', () => {
  it('准备/倒计时保留原始epoch坐标，派生录制时间从实际开始计算', async () => {
    const { collector, pages } = fixture(); collector.start(3_010_000)
    collector.record(3_011_000, { kind: 'cursor', point: [1, 2], shape: 'arrow' })
    await collector.stop(3_012_000)
    expect(pages[0].entries.map(event => event.monoUs)).toEqual([3_000_000, 3_001_000, 3_002_000])
    expect(pages[0].entries.map(event => event.recordingUs)).toEqual([0, 1000, 2000])
  })
  it('多屏负坐标、混合 DPI 与窗口裁剪按源 DIP / 像素换算，外部点不钳到边缘', () => {
    const source = { bounds: { x: -1280, y: -200, width: 1280, height: 720 }, pixels: { width: 2560, height: 1440 } }
    expect(capturePoint({ x: -640, y: 160 }, source)).toEqual([1280, 720])
    expect(capturePoint({ x: 0, y: 160 }, source)).toBeNull()
    expect(captureBounds({ x: -1400, y: -100, width: 600, height: 300 }, source)).toEqual({ x: 0, y: 200, width: 960, height: 600 })
    expect(() => capturePoint({ x: 1, y: 1 }, { ...source, pixels: { width: 0, height: 20 } })).toThrow('坐标')
  })
  it('时钟不倒退，暂停期间不造轨迹或能力；恢复保留空档、媒体时间扣除暂停', async () => {
    const { collector, pages } = fixture()
    collector.start(10_000)
    collector.record(11_000, { kind: 'cursor', point: [10, 20], shape: 'arrow' })
    collector.record(10_500, { kind: 'key', category: 'typing' })
    collector.pause(12_000)
    expect(collector.record(15_000, { kind: 'key', category: 'typing' })).toBeUndefined()
    collector.resume(112_000)
    collector.record(113_000, { kind: 'mark', note: '解释下一步' })
    await collector.stop(114_000)
    const events = pages.flatMap(page => page.entries)
    expect(events.map(event => event.monoUs)).toEqual([0, 1000, 1000, 2000, 102000, 103000, 104000])
    expect(events.at(-1)?.recordingUs).toBe(4001)
    expect(events.filter(event => event.kind === 'key')).toHaveLength(1)
    expect(pages[1].clockSegments.some(clock => clock.mode === 'gap' && clock.monoSpanUs[1] - clock.monoSpanUs[0] === 99999)).toBe(true)
    for (const page of pages) { expect(captureLogPageSchema.safeParse(page).success).toBe(true); for (const event of page.entries) expect(clockEventIssue(event, page.clockSegments)).toBeUndefined() }
  })
  it('分256条页，写入串行、flush等待持久化屏障；页内seq和双时钟错误拒绝', async () => {
    const { collector, pages } = fixture()
    collector.start(10_000)
    for (let index = 0; index < 700; index++) collector.record(11_000 + index, { kind: 'cursor', point: [1, 2], shape: 'unknown' })
    await collector.stop(20_000)
    expect(pages.map(page => page.count)).toEqual([256, 256, 190])
    expect(pages.flatMap(page => page.entries).map(event => event.seq)).toEqual(Array.from({ length: 702 }, (_, i) => i))
    const broken = structuredClone(pages[0]); broken.entries[1].seq = 0
    expect(captureLogPageSchema.safeParse(broken).success).toBe(false)
    broken.entries[1].seq = 1; broken.entries[1].unavailableReason = undefined
    expect(captureLogPageSchema.safeParse(broken).success).toBe(false)
  })
  it('停止在暂停空档只产生边界控制事件；重复停止不重复写页', async () => {
    const { collector, pages } = fixture(); collector.start(10_000); collector.pause(12_000)
    await collector.stop(20_000); await collector.stop(22_000)
    expect(pages.flatMap(page => page.entries).filter(event => event.kind === 'control' && event.action === 'stop')).toHaveLength(1)
    expect(pages.at(-1)?.entries.at(-1)?.unavailableReason).toBe('gap')
  })
  it('写盘失败不能报告保存成功，积压触发暂停，不能静默吞错', async () => {
    const failed = fixture(async () => { throw new Error('disk full') }); failed.collector.start(10_000)
    await expect(failed.collector.stop(11_000)).rejects.toThrow('disk full')
    expect(failed.pressure).toHaveBeenCalled()
    let finish!: () => void
    let writes = 0
    const slow = fixture(() => ++writes === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve()); slow.collector.start(10_000)
    for (let i = 0; i < 1024; i++) slow.collector.record(11_000 + i, { kind: 'key', category: 'typing' })
    expect(slow.pressure).toHaveBeenCalled()
    const flushed = slow.collector.flush(); await Promise.resolve(); finish(); await flushed
    expect(writes).toBe(5)
  })
})
