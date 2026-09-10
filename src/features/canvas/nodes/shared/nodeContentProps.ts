/** 坐标和 dragging 由 ReactFlow 外框消费；正文只接收内容、尺寸及交互权限。
 * 新增节点若需要实时坐标，必须向 ReactFlow 局部订阅，不能依赖正文的移动帧。
 */
export function areNodeContentPropsEqual<T extends object>(previous: T, next: T): boolean {
  const contentKeys = (value: T) => (Object.keys(value) as (keyof T)[]).filter(
    key => key !== 'positionAbsoluteX' && key !== 'positionAbsoluteY' && key !== 'dragging',
  );
  const keys = contentKeys(previous);
  const nextKeys = contentKeys(next);
  return keys.length === nextKeys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(next, key) && Object.is(previous[key], next[key]));
}
