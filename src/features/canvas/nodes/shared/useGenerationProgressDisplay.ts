import { useEffect, useMemo, useState } from 'react';

import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import {
  DEFAULT_PROGRESS_CURVE,
  computeProgress,
  getProgressTransitionDurationMs,
} from '@/core/progress/progressTracker';

interface GenerationProgressSource {
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export interface GenerationProgressDisplay {
  isGenerating: boolean;
  /** 0~1；优先真进度，缺失时按生成 Tab 同款曲线模拟 */
  progress: number;
  /** 进度条 CSS 过渡时长（毫秒），与生成 Tab 的 ProgressBar 保持一致 */
  transitionDurationMs: number;
}

const FALLBACK_TICK_MS = 120;

/** 结果节点的生成进度显示：消费瞬态真进度，回退时复用生成 Tab 同款估时曲线 */
export function useGenerationProgressDisplay(
  nodeId: string,
  data: GenerationProgressSource
): GenerationProgressDisplay {
  const realProgress = useCanvasGenerationProgressStore((state) => state.progress[nodeId]);
  const [now, setNow] = useState(() => Date.now());

  const isGenerating = data.isGenerating === true;
  const generationStartedAt =
    typeof data.generationStartedAt === 'number' ? data.generationStartedAt : null;
  const generationDurationMs =
    typeof data.generationDurationMs === 'number' && data.generationDurationMs > 0
      ? data.generationDurationMs
      : null;

  useEffect(() => {
    if (!isGenerating || typeof realProgress === 'number') {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, FALLBACK_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [isGenerating, realProgress]);

  const progressPercent = useMemo(() => {
    if (!isGenerating) {
      return 0;
    }
    if (typeof realProgress === 'number') {
      return realProgress * 100;
    }
    const startedAt = generationStartedAt ?? Date.now();
    const duration = Math.max(1000, generationDurationMs ?? 1000);
    const elapsed = Math.max(0, now - startedAt);
    return computeProgress(elapsed, {
      expectedDurationMs: duration,
      tickMs: FALLBACK_TICK_MS,
      curve: DEFAULT_PROGRESS_CURVE,
    });
  }, [generationDurationMs, generationStartedAt, isGenerating, now, realProgress]);

  return {
    isGenerating,
    progress: progressPercent / 100,
    transitionDurationMs: getProgressTransitionDurationMs(progressPercent),
  };
}
