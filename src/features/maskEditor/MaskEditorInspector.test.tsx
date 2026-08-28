// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaskEditorInspector } from './MaskEditorInspector';

afterEach(cleanup);

describe('MaskEditorInspector', () => {
  it('在右侧切换绘制与擦除，并同时提供大小和硬度', () => {
    const onModeChange = vi.fn();
    render(
      <MaskEditorInspector
        mode="paint"
        tool="brush"
        brushSize={32}
        brushHardness={0.75}
        maxBrushSize={128}
        confirmError={null}
        onModeChange={onModeChange}
        onBrushSizeChange={() => undefined}
        onBrushHardnessChange={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: '绘制' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '擦除' }));
    expect(onModeChange).toHaveBeenCalledWith('erase');
    expect(screen.getByRole('slider', { name: '画笔大小' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: '画笔硬度' }).getAttribute('value')).toBe('75');
  });

  it('框选工具沿用擦除模式，但不显示无关的画笔参数', () => {
    render(
      <MaskEditorInspector
        mode="erase"
        tool="rectangle"
        brushSize={32}
        brushHardness={1}
        maxBrushSize={128}
        confirmError={null}
        onModeChange={() => undefined}
        onBrushSizeChange={() => undefined}
        onBrushHardnessChange={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: '擦除' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('slider', { name: '画笔大小' })).toBeNull();
    expect(screen.queryByRole('slider', { name: '画笔硬度' })).toBeNull();
    expect(screen.getByText('拖动框出矩形区域，松开后从重绘遮罩中移除。')).toBeTruthy();
  });
});
