import type { WebReplayRenderResult } from '../../platform/contracts/webReplay'

/**
 * `render_web_app_replay` 的领域回执。渲染层收到结果时、主进程在渲染层重载后用登记的结果重建回执时
 * 都只走这里，两边给调用方的字段才不会走样。
 */
export function webReplayRenderOutput(recordingId: string, pointer: boolean, result: WebReplayRenderResult): Record<string, unknown> {
  return {
    resultRef: { kind: 'screen_recording.web_recording', id: recordingId }, video: result.output, pointer, width: result.width, height: result.height, frames: result.frames,
    conflicts: result.issues.filter(i => i.kind === 'conflict').map(i => i.message), warnings: result.issues.filter(i => i.kind === 'warning').map(i => i.message), verified: result.frames > 0,
    ...(result.take ? { take: { name: result.take.name, directory: result.take.directory, video: result.take.video, durationMs: result.take.durationMs, frames: result.take.frames, steps: result.take.steps } } : {}),
  }
}
