import { describe, expect, it } from 'vitest';

import {
  getCanvasSpecialEditorDefinition,
  registerCanvasSpecialEditor,
} from './specialEditorRegistry';

describe('specialEditorRegistry', () => {
  it('注册懒加载实现并阻止重复注册', () => {
    expect(getCanvasSpecialEditorDefinition('multiAngle')).toMatchObject({ key: 'multiAngle' });
    const unregister = registerCanvasSpecialEditor('mask', async () => ({
      default: () => null,
    }));
    expect(getCanvasSpecialEditorDefinition('mask')).toMatchObject({ key: 'mask' });
    expect(() => registerCanvasSpecialEditor('mask', async () => ({
      default: () => null,
    }))).toThrow('重复注册');
    unregister();
    expect(getCanvasSpecialEditorDefinition('mask')).toBeNull();
  });
});
