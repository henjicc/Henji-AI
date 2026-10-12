import { describe, expect, it, vi } from 'vitest'
import { noopLogger, noopTracer, type RuntimeContext } from '@henjicc/ai-sdk'

const diagnostic = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: vi.fn(() => diagnostic) }))

import {
  assertElectronHostCapabilities, inspectElectronHostCapabilities, runElectronHostSelfCheck,
  type ElectronHostRuntime,
} from './host-capabilities'
import { createMainLogger } from '../logging'

function completeRuntime(): ElectronHostRuntime {
  return {
    transport: { fetch: vi.fn(), uploadFile: vi.fn(), fetchStream: vi.fn() },
    media: { read: vi.fn(), describe: vi.fn(), readChunk: vi.fn() },
    credentials: { get: vi.fn() }, logger: noopLogger, tracer: noopTracer,
  }
}

describe('Electron host contract', () => {
  it('compile-time: an SDK partial transport cannot construct the Electron host runtime', () => {
    const full = completeRuntime()
    const { uploadFile: _uploadFile, ...partialTransport } = full.transport
    const partial = { ...full, transport: partialTransport }
    // @ts-expect-error Electron host transport requires uploadFile even though SDK Transport makes it optional.
    const rejected: ElectronHostRuntime = partial
    expect(rejected.transport.uploadFile).toBeUndefined()
  })

  it('startup aggregates missing hooks into one structured error via the existing main log sink', () => {
    diagnostic.error.mockClear()
    diagnostic.info.mockClear()
    const runtime: RuntimeContext = completeRuntime()
    delete runtime.transport.uploadFile
    delete runtime.media.readChunk
    delete runtime.logger
    const report = runElectronHostSelfCheck(runtime)
    expect(report.missing).toEqual(['transport.uploadFile', 'media.readChunk', 'logger.info', 'logger.warn', 'logger.error'])
    expect(report.affectedCapabilities).toEqual(['file-asr', 'generation', 'llm'])
    expect(diagnostic.error).toHaveBeenCalledTimes(1)
    expect(diagnostic.error).toHaveBeenCalledWith('AI 宿主能力自检失败', {
      event: 'ai_runtime.host_selfcheck.failed', context: report,
    })
    expect(diagnostic.info).not.toHaveBeenCalled()
    expect(createMainLogger).toHaveBeenCalledWith('main.ai-runtime.host')
    expect(runtime.credentials.get).not.toHaveBeenCalled()
    expect(runtime.transport.fetch).not.toHaveBeenCalled()
    expect(() => assertElectronHostCapabilities(runtime, ['file-asr'])).toThrow('宿主不支持')
  })

  it('unused realtime is optional; attempting to enable it fails before opening a connection', () => {
    const runtime = completeRuntime()
    expect(inspectElectronHostCapabilities(runtime).missing).toEqual([])
    expect(runElectronHostSelfCheck(runtime, { info: vi.fn(), error: vi.fn() })).toEqual({ missing: [], affectedCapabilities: [] })
    expect(() => assertElectronHostCapabilities(runtime, ['realtime-asr'])).toThrow('host_capability_unsupported')
    runtime.realtime = { connect: vi.fn() }
    expect(inspectElectronHostCapabilities(runtime, ['realtime-asr']).missing).toEqual([])
    expect(runtime.realtime.connect).not.toHaveBeenCalled()
  })
})
