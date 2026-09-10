import { expect, it } from 'vitest';
import { getBezierPath, Position } from '@xyflow/react';
import { getEdgeFlowPathBounds } from './edgeFlowPathBounds';

it('控制点包围盒覆盖反向贝塞尔曲线，不把回弯段错误剔除', () => {
  const [path] = getBezierPath({ sourceX: 400, sourceY: 200, targetX: 50, targetY: 600,
    sourcePosition: Position.Right, targetPosition: Position.Left });
  const bounds = getEdgeFlowPathBounds(path)!;
  expect(bounds.left).toBeLessThan(50);
  expect(bounds.right).toBeGreaterThan(400);
  expect(bounds.top).toBe(196);
  expect(bounds.bottom).toBe(604);
});
it('接受负数、科学计数与直线；不认识的路径保留原采样兼容路径', () => {
  expect(getEdgeFlowPathBounds('M-1e2,10 L200,3e2')).toEqual({ left: -104, top: 6, right: 204, bottom: 304 });
  expect(getEdgeFlowPathBounds('M0,0 Q40,100 200,0')).toBeNull();
  expect(getEdgeFlowPathBounds('MNaN,0L20,0')).toBeNull();
});
