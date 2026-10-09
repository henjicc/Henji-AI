import { createCpuRegionWorkerRuntimeV3 } from './cpuRegionWorkerRuntime'
import type { CpuRegionWorkerEventV3, CpuRegionWorkerRequestV3 } from './cpuRegionWorkerProtocol'

const scope = globalThis as unknown as {
  onmessage: ((event: { data: CpuRegionWorkerRequestV3 }) => void) | null
  postMessage(event: CpuRegionWorkerEventV3, transfer?: ArrayBuffer[]): void
}
const receive = createCpuRegionWorkerRuntimeV3((event, transfer) => scope.postMessage(event, transfer))
scope.onmessage = (event) => { void receive(event.data) }
