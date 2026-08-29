import { describe, expect, it } from 'vitest';

import {
  getCanvasSpecialEditorDefinition,
  registerCanvasSpecialEditor,
} from './specialEditorRegistry';

describe('specialEditorRegistry', () => {
  it('预注册唯一蒙版编辑器并阻止重复注册', () => {
    expect(getCanvasSpecialEditorDefinition('multiAngle')).toMatchObject({ key: 'multiAngle' });
    expect(getCanvasSpecialEditorDefinition('mask')).toMatchObject({ key: 'mask' });
    expect(() => registerCanvasSpecialEditor('mask', async () => ({
      default: () => null,
    }))).toThrow('重复注册');
  });
});
