import { AiRuntimeError, type RuntimeContext, type Transport, type MediaReader } from '@henjicc/ai-sdk'
import { createMainLogger } from '../logging'

/** Electron's enabled HTTP capabilities must never fall back to the SDK's partial-host contract. */
export type ElectronHostTransport = Required<Transport>
export type ElectronHostMediaReader = Required<MediaReader>
export type ElectronHostRuntime = Omit<Required<RuntimeContext>, 'transport' | 'media' | 'realtime'> & {
  transport: ElectronHostTransport
  media: ElectronHostMediaReader
  // No realtime modules are registered by this host. Check before enabling/opening one.
  realtime?: RuntimeContext['realtime']
}

export type HostCapability = 'generation' | 'llm' | 'file-asr' | 'realtime-asr'
const all: readonly HostCapability[] = ['generation', 'llm', 'file-asr', 'realtime-asr']
const http: readonly HostCapability[] = ['generation', 'llm', 'file-asr']
const fileAsr: readonly HostCapability[] = ['file-asr']

/** Exhaustive over SDK host interfaces: adding even an optional hook requires an explicit decision here. */
const requirements = {
  transport: { fetch: http, fetchStream: fileAsr, uploadFile: fileAsr },
  media: { read: http, describe: fileAsr, readChunk: fileAsr },
  credentials: { get: all },
  logger: { info: all, warn: all, error: all },
  tracer: { startSpan: all },
  realtime: { connect: ['realtime-asr'] },
} satisfies {
  [K in keyof Required<RuntimeContext>]: {
    [M in keyof Required<NonNullable<RuntimeContext[K]>>]: readonly HostCapability[]
  }
}

export interface HostCapabilityReport {
  missing: string[]
  affectedCapabilities: HostCapability[]
}

export function inspectElectronHostCapabilities(
  runtime: RuntimeContext,
  enabled: readonly HostCapability[] = http,
): HostCapabilityReport {
  const missing: string[] = []
  const affected = new Set<HostCapability>()
  for (const [group, methods] of Object.entries(requirements)) {
    const adapter = runtime[group as keyof RuntimeContext] as unknown as Record<string, unknown> | undefined
    for (const [method, capabilities] of Object.entries(methods)) {
      const needed = (capabilities as readonly HostCapability[]).filter(capability => enabled.includes(capability))
      if (needed.length && typeof adapter?.[method] !== 'function') {
        missing.push(`${group}.${method}`)
        needed.forEach(capability => affected.add(capability))
      }
    }
  }
  return { missing, affectedCapabilities: [...affected] }
}

/** Guard before paid work; does not inspect credentials, read media, or send requests. */
export function assertElectronHostCapabilities(runtime: RuntimeContext, enabled: readonly HostCapability[]): void {
  const report = inspectElectronHostCapabilities(runtime, enabled)
  if (report.missing.length) {
    throw new AiRuntimeError('host_capability_unsupported', '宿主不支持此操作所需的能力；未提交请求、未计费。', {
      ...report, retryable: false, billing: 'not_charged', execution: { notExecuted: true },
    })
  }
}

const logger = createMainLogger('main.ai-runtime.host')

/** Runs after app readiness; the existing structured log sink supplies diagnostics/history. */
export function runElectronHostSelfCheck(
  runtime: RuntimeContext,
  diagnosticLogger: Pick<typeof logger, 'error' | 'info'> = logger,
): HostCapabilityReport {
  const report = inspectElectronHostCapabilities(runtime)
  if (report.missing.length) {
    diagnosticLogger.error('AI 宿主能力自检失败', { event: 'ai_runtime.host_selfcheck.failed', context: report })
  } else {
    diagnosticLogger.info('AI 宿主能力自检完成', { event: 'ai_runtime.host_selfcheck.completed', context: { enabledCapabilities: http } })
  }
  return report
}
