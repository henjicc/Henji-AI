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
      coverPath: null,
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

  it('结构化提示词、内联媒体和 binding 经媒体池编码后可完整恢复', () => {
    const mediaPath = 'C:\\media\\prompt-reference.png';
    const node = {
      id: 'generation-node',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 0, y: 0 },
      data: {
        imageUrl: null,
        aspectRatio: '1:1',
        prompt: '参考@图片1',
        mediaInputs: { image: [mediaPath] },
        promptMediaBindings: [{
          resourceId: 'canvas-local:generation-node:media-1',
          mediaType: 'image',
          dataUrl: mediaPath,
          filePath: mediaPath,
        }],
        promptDocument: {
          version: 1,
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: '参考' },
              {
                type: 'mediaReference',
                attrs: {
                  resourceId: 'canvas-local:generation-node:media-1',
                  mediaType: 'image',
                  fallbackLabel: '图片1',
                },
              },
            ],
          }],
        },
      },
    } as CanvasNode;
    const project: Project = {
      id: 'structured-project',
      name: '结构化提示词工程',
      createdAt: 1,
      updatedAt: 2,
      nodeCount: 1,
      coverPath: null,
      nodes: [node],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      history: { past: [{ nodes: [node], edges: [] }], future: [] },
    };

    const restored = decodeProjectRecord(encodeProjectAsRecord(project));
    for (const restoredNode of [restored.nodes[0], restored.history.past[0].nodes[0]]) {
      expect(restoredNode.data.mediaInputs).toEqual({ image: [mediaPath] });
      expect(restoredNode.data.promptMediaBindings).toEqual([expect.objectContaining({
        dataUrl: mediaPath,
        filePath: mediaPath,
      })]);
      expect(JSON.stringify(restoredNode.data.promptDocument))
        .toContain('canvas-local:generation-node:media-1');
    }
  });
});
