import { describe, expect, it } from 'vitest';

import {
  getCanvasSpecialEditorDefinition,
  registerCanvasSpecialEditor,
} from './specialEditorRegistry';

describe('specialEditorRegistry', () => {
  it('注册懒加载实现并阻止重复注册', () => {
    const unregister = registerCanvasSpecialEditor('multiAngle', async () => ({
      default: () => null,
    }));
    expect(getCanvasSpecialEditorDefinition('multiAngle')).toMatchObject({ key: 'multiAngle' });
    expect(() => registerCanvasSpecialEditor('multiAngle', async () => ({
      default: () => null,
    }))).toThrow('重复注册');
    unregister();
    expect(getCanvasSpecialEditorDefinition('multiAngle')).toBeNull();
  });
});
