import { describe, expect, it, vi } from 'vitest';
import { completeInPlaceGeneration } from './inPlaceGeneration';
describe('多宿主原地生成完成内核', () => {
  it('保存失败后复用回执，只续保存，不重复等待或落位', async () => {
    let applied: string | undefined;
    const ports = { signal: new AbortController().signal, readApplied: () => applied, wait: vi.fn(async () => ({ ok: true as const })),
      place: vi.fn(async () => 'layer'), markApplied: (value: string) => { applied = value; }, save: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined) };
    await expect(completeInPlaceGeneration(ports)).rejects.toThrow('disk full');
    expect(applied).toBe('layer');
    await expect(completeInPlaceGeneration(ports)).resolves.toBe('layer');
    expect(ports.wait).toHaveBeenCalledTimes(1); expect(ports.place).toHaveBeenCalledTimes(1); expect(ports.save).toHaveBeenCalledTimes(2);
  });
  it('取消或供应商失败不落位；落位后的取消仍保存已应用内容', async () => {
    const controller = new AbortController();
    const ports = { signal: controller.signal, readApplied: () => undefined, wait: vi.fn(async () => ({ ok: false as const, error: 'provider failed' })),
      place: vi.fn(async () => 'clip'), markApplied: vi.fn(), save: vi.fn(async () => undefined) };
    await expect(completeInPlaceGeneration(ports)).rejects.toThrow('provider failed'); expect(ports.place).not.toHaveBeenCalled();
    controller.abort(); await expect(completeInPlaceGeneration(ports)).rejects.toThrow(); expect(ports.save).not.toHaveBeenCalled();
    const late = new AbortController();
    await completeInPlaceGeneration({ ...ports, signal: late.signal, wait: async () => ({ ok: true }), place: async () => { late.abort(); return 'clip'; } });
    expect(ports.markApplied).toHaveBeenCalledWith('clip'); expect(ports.save).toHaveBeenCalledTimes(1);
  });
});
