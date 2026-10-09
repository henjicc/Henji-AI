import type { Coverage, RegionGrid, RegionRect, RegionSampleTime } from '../regions';

export interface EvaluationInputRequest {
  ref: { kind: string; id: string };
  sourceVersion: string;
  time: RegionSampleTime;
  roi: RegionRect;
  signal?: AbortSignal;
}

/** 宿主绑定资源/区域读取；算法不访问文件路径、当前播放头或 feature。 */
export interface EvaluationInputs {
  readPixels(request: EvaluationInputRequest): Promise<{
    region: RegionRect; data: Float32Array; alpha: 'premultiplied' | 'straight';
    workingSpace: string; transferFunction: string;
  }>;
  readCoverage(request: EvaluationInputRequest): Promise<Coverage>;
}

/** Host-neutral source sampling: speed/trim/reverse are resolved by the host. */
export interface EvaluationContext {
  target: { kind: string; id: string };
  sourceVersion: string;
  time: RegionSampleTime;
  referenceGrid: RegionGrid;
  roi: RegionRect;
  color: { workingSpace: string; transferFunction: string; alpha: 'premultiplied' | 'straight'; precision: 'float16' | 'float32' };
  quality: 'interactive' | 'final';
  signal?: AbortSignal;
  inputs?: EvaluationInputs;
}

/** Complete cache identity; UI/viewport state is deliberately supplied as ROI only. */
export function evaluationCacheIdentity(context: EvaluationContext): string {
  if (!context.sourceVersion || !context.target.id || !context.target.kind
    || ![context.referenceGrid.width, context.referenceGrid.height].every(value => Number.isSafeInteger(value) && value > 0)
    || ![context.roi.x, context.roi.y, context.roi.width, context.roi.height].every(Number.isFinite)
    || context.roi.width < 0 || context.roi.height < 0) throw new Error('求值目标、网格或区域无效');
  if (context.time.kind === 'frame' && (!Number.isSafeInteger(context.time.ticks)
    || !context.time.timeBase.every(value => Number.isSafeInteger(value) && value > 0)
    || !context.time.frameId)) throw new Error('源时间必须是有理时间基的整数采样');
  return JSON.stringify([context.target.kind, context.target.id, context.sourceVersion,
    context.time, context.referenceGrid, context.roi, context.color, context.quality]);
}
