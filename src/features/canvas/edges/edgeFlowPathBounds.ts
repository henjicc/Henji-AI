/** ReactFlow 的绝对 M/L/C 路径位于端点与控制点的包围盒内。
 * 保守包围盒只用于离屏剔除；曲线仍由原始 Path2D 绘制，不用采样近似。
 */
export function getEdgeFlowPathBounds(path: string) {
  if (!path.startsWith('M') || /[^\d\s.,eE+\-MLC]/.test(path)) return null;
  const coordinates = path.replace(/[MLC]/g, ' ').trim().split(/[\s,]+/).map(Number);
  if (coordinates.length < 4 || coordinates.length % 2 || coordinates.some(value => !Number.isFinite(value))) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i < coordinates.length; i += 2) {
    left = Math.min(left, coordinates[i]); right = Math.max(right, coordinates[i]);
    top = Math.min(top, coordinates[i + 1]); bottom = Math.max(bottom, coordinates[i + 1]);
  }
  return { left: left - 4, top: top - 4, right: right + 4, bottom: bottom + 4 };
}
