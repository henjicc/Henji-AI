import { describe, expect, it } from 'vitest';
import { init } from 'vgpu/mock';

import { VgpuUploadTexture } from './vgpuUploadTexture';

describe('VgpuUploadTexture', () => {
  it('尺寸变化时替换 Texture identity，而不是原地 resize', async () => {
    const gpu = await init();
    const upload = new VgpuUploadTexture(gpu, 'upload-test');
    const initial = upload.texture;
    const initialIdentity = initial.resourceIdentity;

    expect(upload.ensureSize([1, 1])).toBe(false);
    expect(upload.texture).toBe(initial);

    expect(upload.ensureSize([960.9, 540.8])).toBe(true);
    expect(upload.texture).not.toBe(initial);
    expect(upload.texture.resourceIdentity).not.toBe(initialIdentity);
    expect(upload.texture.size).toEqual([960, 540]);
    expect(() => initial.createView()).toThrow();

    upload.destroy();
    gpu.dispose();
  });
});
