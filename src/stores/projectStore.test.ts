import { describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';

import { decodeProjectRecord, encodeProjectAsRecord, type Project } from './projectStore';

function createRenderingCameraStageNode(): CanvasNode {
  return {
    id: 'camera-stage-node',
    type: CANVAS_NODE_TYPES.cameraStage,
    position: { x: 0, y: 0 },
    data: {
      displayName: '3D 镜头参考',
      projectId: 'camera-project',
      imageUrl: null,
      videoUrl: 'henji-media://completed.mp4',
      aspectRatio: '16:9',
      durationSec: 5.2,
      selectedTimeSec: 0,
      outputKind: 'video',
      videoExporting: true,
      videoProgress: 0.42,
      videoRenderPhase: 'rendering',
      videoRenderRequestId: 'stale-request',
      videoRenderError: 'stale-error',
    },
  };
}

describe('encodeProjectAsRecord', () => {
  it('不会把节点和历史快照中的瞬时渲染状态写入工程记录', () => {
    const node = createRenderingCameraStageNode();
    const project: Project = {
      id: 'project',
      name: '测试工程',
      createdAt: 1,
      updatedAt: 2,
      nodeCount: 1,
      nodes: [node],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      history: {
        past: [{ nodes: [node], edges: [] }],
        future: [],
      },
    };

    const record = encodeProjectAsRecord(project);
    const restored = decodeProjectRecord(record);

    for (const data of [restored.nodes[0].data, restored.history.past[0].nodes[0].data]) {
      expect(data.videoExporting).toBe(false);
      expect(data.videoProgress).toBeNull();
      expect(data.videoRenderPhase).toBeNull();
      expect(data.videoRenderRequestId).toBeNull();
      expect(data.videoRenderError).toBeNull();
      expect(data.videoUrl).toBe('henji-media://completed.mp4');
    }
  });
});
