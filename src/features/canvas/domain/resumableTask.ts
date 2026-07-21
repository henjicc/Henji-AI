/**
 * 画布结果节点的「服务端异步任务待续查」判定。
 *
 * 异步生成（视频尤其常见）在供应商侧可能跑十几分钟，期间用户完全可能关掉软件。
 * 只要任务 ID 已登记且节点还没拿到媒体结果，这次生成就不算结束——重启后应该接着查，
 * 而不是把生成态抹掉、把任务丢掉。
 *
 * 判定同时被两处使用，必须单点实现：
 * - resetTransientNodeRuntimeState（加载/持久化时决定是否保留生成态）
 * - useCanvasResumePolling（决定重启后对哪些节点续查）
 */

/** 结果节点承载媒体产物的字段，按媒体类型分别落位 */
const RESULT_MEDIA_KEYS = ['imageUrl', 'videoUrl', 'audioUrl'] as const;

function isNonEmptyString(value: DynamicValue): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasGenerationResult(data: DynamicValueMap): boolean {
  return RESULT_MEDIA_KEYS.some((key) => isNonEmptyString(data[key]));
}

export interface ResumableServerTask {
  taskId: string;
  modelId: string;
}

/**
 * 取出节点上待续查的服务端任务；不具备续查条件时返回 null。
 * 缺少 modelId 时无法续查（continuePolling 需要用原模型解析结果），视为不可恢复。
 */
export function readResumableServerTask(data: DynamicValueMap): ResumableServerTask | null {
  const taskId = typeof data.serverTaskId === 'string' ? data.serverTaskId.trim() : '';
  const modelId = typeof data.serverTaskModelId === 'string' ? data.serverTaskModelId.trim() : '';
  if (!taskId || !modelId) {
    return null;
  }
  if (hasGenerationResult(data)) {
    return null;
  }
  return { taskId, modelId };
}

export function hasResumableServerTask(data: DynamicValueMap): boolean {
  return readResumableServerTask(data) !== null;
}
