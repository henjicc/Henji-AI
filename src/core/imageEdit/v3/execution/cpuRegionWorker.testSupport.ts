import { build } from 'vite'
import { Worker as NodeWorker } from 'node:worker_threads'
import type { CpuRegionWorkerEventV3, CpuRegionWorkerPortV3, CpuRegionWorkerRequestV3 } from './cpuRegionWorkerProtocol'

/** 用真实独立 Node 线程跑同一 Worker runtime；只替换浏览器消息适配器。 */
export async function buildCpuRegionTestWorkerV3(): Promise<string> {
  const built = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, minify: false, target: 'es2022',
    lib: { entry: 'src/core/imageEdit/v3/execution/cpuRegionWorkerRuntime.ts', formats: ['cjs'], fileName: 'cpu-region-test' },
  } })
  const bundle = Array.isArray(built) ? built[0] : built
  if (!('output' in bundle)) throw new Error('CPU test Worker bundle unavailable')
  const entry = bundle.output.find(item => item.type === 'chunk' && item.isEntry)
  if (!entry || entry.type !== 'chunk') throw new Error('CPU test Worker entry unavailable')
  return `${entry.code}\nconst { parentPort } = require('node:worker_threads');
const receive = module.exports.createCpuRegionWorkerRuntimeV3((event, transfer) => parentPort.postMessage(event, transfer));
parentPort.on('message', message => { void receive(message); });`
}

export class CpuRegionNodeTestWorkerV3 {
  onmessage: ((event: { data: CpuRegionWorkerEventV3 }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  private readonly worker: NodeWorker
  constructor(source: string) {
    this.worker = new NodeWorker(source, { eval: true })
    this.worker.on('message', (data: CpuRegionWorkerEventV3) => this.onmessage?.({ data }))
    this.worker.on('error', (error) => this.onerror?.({ message: error.message }))
    this.worker.on('messageerror', () => this.onmessageerror?.())
  }
  postMessage(message: CpuRegionWorkerRequestV3): void { this.worker.postMessage(message) }
  terminate(): void { void this.worker.terminate() }
  port(): CpuRegionWorkerPortV3 {
    return { postMessage: (message) => this.postMessage(message), terminate: () => this.terminate(),
      subscribe: (receive, fail) => {
        this.onmessage = ({ data }) => receive(data)
        this.onerror = ({ message }) => fail(new Error(message))
        this.onmessageerror = () => fail(new Error('Worker message decode failed'))
      } }
  }
}
