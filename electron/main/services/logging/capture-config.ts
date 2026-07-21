/**
 * 日志捕获模式配置（内存态，不落盘、不持久化）。
 *
 * - `standard`：沿用 `sanitize.ts` 现有截断策略，控制日志体积（默认）。
 * - `full`：长文本（超长 prompt、完整响应）与图片 `data:image/*` base64 原文保留，
 *   用于排查"看到真实原始内容"的诉求；音频/视频及无法识别类型的超长裸 base64
 *   仍强制走摘要，脱敏（`isSensitiveKey`）任何模式下都强制生效，不受此配置影响。
 *
 * 只保存在主进程内存中：应用重启（而非渲染层热更新/刷新）会回落默认值 `standard`，
 * 避免用户忘记关闭"完整捕获"导致日志长期膨胀。切换通过 IPC `logging:setCaptureConfig`
 * 同步（见 `electron/main/ipc/logging.ts`），读取方直接调用 `getLogCaptureMode()`，
 * 无需额外的事件订阅即可做到"即时生效"。
 */

export type LogCaptureMode = 'standard' | 'full'

let captureMode: LogCaptureMode = 'standard'

export function getLogCaptureMode(): LogCaptureMode {
  return captureMode
}

export function setLogCaptureMode(mode: LogCaptureMode): void {
  captureMode = mode === 'full' ? 'full' : 'standard'
}
