import { describe, expect, it } from 'vitest';
import { getImageEditorHostProfileV3 } from './imageEditorHostProfiles';

describe('图片编辑 V3 宿主能力裁剪', () => {
  it('完整工具箱暴露图层、颜色、HDR、包保存与导出', () => {
    expect(getImageEditorHostProfileV3('full')).toMatchObject({
      layerKinds: ['raster', 'annotation', 'effect', 'adjustment', 'group'],
      panels: ['layers', 'properties', 'histogram', 'color', 'history'],
      saveActions: ['save-document', 'save-package', 'export-raster'],
      allowHdr: true,
    });
  });

  it('遮罩宿主只留下选择、画笔和蒙版上下文', () => {
    const profile = getImageEditorHostProfileV3('mask');
    expect(profile.effects).toEqual([]);
    expect(profile.adjustments).toEqual([]);
    expect(profile.tools).toEqual(expect.arrayContaining([
      'select-rect', 'select-ellipse', 'select-lasso', 'raster-brush', 'eraser', 'mask-edit',
    ]));
    expect(profile.saveActions).toEqual(['save-document']);
  });
});
