import { beforeAll, expect, it } from 'vitest'
import { holdWorkers, WORKER_REPLY_LIMIT_MS } from './workerHold'

/** A worker that answers only when told to. */
class FakeWorker extends EventTarget {
  posted = 0
  postMessage(): void { this.posted += 1 }
  terminate(): void {}
  reply(): void { this.dispatchEvent(new Event('message')) }
}
type WorkerCtor = new () => FakeWorker

const holds: Array<Promise<unknown>> = []
const warnings: string[] = []
const wall: Array<{ at: number; run: () => void }> = []
let wallNow = 0
const passWall = (ms: number): void => { wallNow += ms; for (const timer of wall.splice(0)) { if (timer.at <= wallNow) timer.run(); else wall.push(timer) } }
const settled = (work: Promise<unknown>): Promise<boolean> => Promise.race([work.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 0))])
const page = globalThis as unknown as Record<string, unknown> & { Worker: WorkerCtor }

beforeAll(() => {
  page.window = globalThis
  page.Worker = FakeWorker
  const wallTimeout = (run: () => void, ms: number): (() => void) => {
    const timer = { at: wallNow + ms, run }
    wall.push(timer)
    return () => { const i = wall.indexOf(timer); if (i >= 0) wall.splice(i, 1) }
  }
  holdWorkers(work => holds.push(work), wallTimeout, message => warnings.push(message))
})

it('发消息后到回复前页面时间停住；同一 Worker 连发只停一次；出现 Worker 提醒一次', async () => {
  const worker = new page.Worker()
  new page.Worker()
  expect(warnings).toHaveLength(1)
  worker.postMessage()
  worker.postMessage()
  expect(worker.posted).toBe(2)
  expect(holds).toHaveLength(1)
  expect(await settled(holds[0])).toBe(false)
  worker.reply()
  expect(await settled(holds[0])).toBe(true)
  expect(wall).toHaveLength(0)
})

it('1 秒没回复就放行，整个重演只提醒一次；之后的消息仍按 1 秒上限等；terminate 后不再等', async () => {
  const slow = new page.Worker()
  const other = new page.Worker()
  holds.length = 0
  warnings.length = 0
  slow.postMessage()
  passWall(WORKER_REPLY_LIMIT_MS - 1)
  expect(await settled(holds[0])).toBe(false)
  passWall(1)
  expect(await settled(holds[0])).toBe(true)
  slow.postMessage()
  expect(holds).toHaveLength(2)
  slow.reply()
  expect(await settled(holds[1])).toBe(true)
  other.postMessage()
  passWall(WORKER_REPLY_LIMIT_MS)
  expect(await settled(holds[2])).toBe(true)
  expect(warnings).toHaveLength(1)

  const stopped = new page.Worker()
  stopped.postMessage()
  stopped.terminate()
  expect(await settled(holds[3])).toBe(true)
  stopped.postMessage()
  expect(holds).toHaveLength(4)
})

it('连续两次等满 1 秒的 Worker 之后发消息不再停表，它回复一次后重新开始等', async () => {
  const listener = new page.Worker()
  holds.length = 0
  for (let i = 0; i < 2; i += 1) {
    listener.postMessage()
    passWall(WORKER_REPLY_LIMIT_MS)
    expect(await settled(holds[i])).toBe(true)
  }
  listener.postMessage()
  listener.postMessage()
  expect(holds).toHaveLength(2)
  listener.reply()
  listener.postMessage()
  expect(holds).toHaveLength(3)
  expect(await settled(holds[2])).toBe(false)
  listener.reply()
  expect(await settled(holds[2])).toBe(true)
})
