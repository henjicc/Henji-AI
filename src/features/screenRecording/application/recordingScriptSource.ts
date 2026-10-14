import { generateRecordingScript, type RecordingScript } from '@/core/screenRecording/script'
import type { RecordingDocument } from '@/core/screenRecording/document'
import type { CaptureEvent } from '@/core/captureLog/events'
import { recordingEvents } from './recordingService'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { isNavigationOnlyCapability } from '@/core/application-control/applicationCapabilities'

export function recordingScriptIgnoredCapabilities(): Set<string> {
  return new Set([...BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().filter(v => v.readOnly || isNavigationOnlyCapability(v)).map(v => v.id), ...['start', 'pause', 'resume', 'mark', 'stop', 'cancel'].map(action => `${action}_screen_recording`)])
}

export async function recordedScriptSource(id: string, recording: RecordingDocument, signal?: AbortSignal): Promise<RecordingScript> {
  const events: CaptureEvent[] = []
  let offset: number | null = 0
  while (offset !== null) {
    signal?.throwIfAborted()
    const page = await recordingEvents(id, offset, 256)
    events.push(...page.events.filter(v => v.kind === 'capability'))
    if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error('事件分页未推进。')
    offset = page.nextOffset
  }
  const ignored = recordingScriptIgnoredCapabilities()
  return generateRecordingScript(recording.understanding, events, recording.scriptCapture, ignored)
}
/** Editing a parameter must never turn an incomplete/unsupported recorded call into an executable one. */
export function assertRecordedScriptEdits(script: RecordingScript, authority: RecordingScript): void {
  if (script.steps.length !== authority.steps.length) throw new Error('脚本步骤已变化，请重新生成脚本。')
  for (const [index, step] of script.steps.entries()) {
    const original = authority.steps[index]
    const signature = (value: RecordingScript['steps'][number]): string => JSON.stringify({ id: value.id, startUs: value.startUs, endUs: value.endUs, narrationIds: value.narrationIds, blockedReason: value.blockedReason, operations: value.operations.map(v => ({ target: v.target, properties: Object.keys(v.properties).sort() })) })
    if (signature(step) !== signature(original)) throw new Error('只能编辑步骤标题、已捕获参数和停留时间；不能解除阻断、更换目标或添加操作。')
  }
}
