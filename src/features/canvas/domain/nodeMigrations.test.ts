import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES } from './canvasNodes';
import { resetTransientNodeRuntimeState } from './nodeMigrations';

describe('resetTransientNodeRuntimeState', () => {
  it('清理 3D 镜头节点无法恢复的视频渲染状态并保留结果', () => {
    const data: DynamicValueMap = {
      projectId: 'camera-project',
      outputKind: 'video',
      videoUrl: 'henji-media://completed.mp4',
      durationSec: 5.2,
      videoExporting: true,
      videoProgress: 0.42,
      videoRenderPhase: 'rendering',
      videoRenderRequestId: 'stale-request',
      videoRenderError: 'stale-error',
    };

    resetTransientNodeRuntimeState(CANVAS_NODE_TYPES.cameraStage, data);

    expect(data).toMatchObject({
      projectId: 'camera-project',
      outputKind: 'video',
      videoUrl: 'henji-media://completed.mp4',
      durationSec: 5.2,
      videoExporting: false,
      videoProgress: null,
      videoRenderPhase: null,
      videoRenderRequestId: null,
      videoRenderError: null,
    });
  });

  it('继续清理普通生成节点的旧生成状态', () => {
    const data: DynamicValueMap = {
      isGenerating: true,
      generationStartedAt: 123,
      imageUrl: 'henji-media://completed.png',
    };

    resetTransientNodeRuntimeState(CANVAS_NODE_TYPES.imageEdit, data);

    expect(data).toEqual({
      isGenerating: false,
      generationStartedAt: null,
      imageUrl: 'henji-media://completed.png',
    });
  });
});
