import { useEffect, useMemo, useState } from 'react';

import { useCanvasStore } from '@/stores/canvasStore';

interface GenerationProgressSource {
  isGenerating?: boolean;
  generationStartedAt?: number | null;
  generationDurationMs?: number;
  [key: string]: DynamicValue;
}

export interface GenerationProgressDisplay {
  isGenerating: boolean;
  /** 0~1；优先真进度，缺失时按估时模拟（封顶 0.96） */
  progress: number;
}

/** 结果节点的生成进度显示：消费瞬态真进度，回退估时模拟 */
export function useGenerationProgressDisplay(
  nodeId: string,
  data: GenerationProgressSource
): GenerationProgressDisplay {
  const realProgress = useCanvasStore((state) => state.nodeGenerationProgress[nodeId]);
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
    }, 120);
    return () => {
      window.clearInterval(timer);
    };
  }, [isGenerating, realProgress]);

  const progress = useMemo(() => {
    if (!isGenerating) {
      return 0;
    }
    if (typeof realProgress === 'number') {
      return realProgress;
    }
    const startedAt = generationStartedAt ?? Date.now();
    const duration = Math.max(1000, generationDurationMs ?? 1000);
    const elapsed = Math.max(0, now - startedAt);
    return Math.min(elapsed / duration, 0.96);
  }, [generationDurationMs, generationStartedAt, isGenerating, now, realProgress]);

  return { isGenerating, progress };
}
