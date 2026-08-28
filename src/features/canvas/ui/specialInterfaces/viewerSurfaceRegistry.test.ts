import { describe, expect, it } from 'vitest';

import {
  getCanvasViewerSurfaceDefinition,
  listCanvasViewerSurfaceDefinitions,
} from './viewerSurfaceRegistry';

describe('viewerSurfaceRegistry', () => {
  it('为平面与全景模式提供稳定的懒加载路由', () => {
    expect(listCanvasViewerSurfaceDefinitions().map((item) => item.mode)).toEqual([
      'image',
      'panorama',
    ]);
    expect(getCanvasViewerSurfaceDefinition('panorama')).toMatchObject({
      mode: 'panorama',
      fallbackMode: 'image',
    });
  });

  it('未知模式安全降级为平面查看', () => {
    expect(getCanvasViewerSurfaceDefinition('future-viewer')).toMatchObject({
      mode: 'image',
      fallbackMode: null,
    });
  });
});
