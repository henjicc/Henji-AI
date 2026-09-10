import { describe, expect, it } from 'vitest';
import { areNodeContentPropsEqual } from './nodeContentProps';

describe('节点正文更新边界', () => {
  const data = { prompt: '原文' };
  const props = { id: 'a', data, selected: false, width: 300, height: 220,
    positionAbsoluteX: 0, positionAbsoluteY: 0, dragging: false, isConnectable: true };
  it('只忽略由ReactFlow外框消费的移动帧', () => {
    expect(areNodeContentPropsEqual(props, { ...props, positionAbsoluteX: 90, positionAbsoluteY: 50, dragging: true })).toBe(true);
  });
  it.each([
    { selected: true }, { width: 400 }, { height: 350 }, { data: { prompt: '新文' } },
    { isConnectable: false }, { id: 'b' }, { newProperty: true },
  ])('内容、尺寸、权限及新增属性仍更新：%j', patch => {
    expect(areNodeContentPropsEqual(props, { ...props, ...patch })).toBe(false);
  });
});
