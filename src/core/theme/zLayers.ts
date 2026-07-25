/**
 * 浮层层级的 TS 常量镜像。
 *
 * 绝大多数场景请直接用 Tailwind 语义类（`z-modal` / `z-toast` / `z-drag` …）。
 * 只有必须写内联 `style={{ zIndex }}` 的地方（例如跟随鼠标、每帧改 transform 的
 * 拖拽预览层）才用这里的常量。
 *
 * ⚠️ 必须与 `tailwind.config.js` 的 `theme.extend.zIndex` 保持一致。
 * 改动任意一侧都要同步另一侧——这与 colorTokens.ts 镜像 CSS 变量是同一套约定。
 *
 * 不属于本层级体系的局部层叠：
 * - 画布内部（ReactFlow 节点、minimap、Alt 拖拽副本）有自己的一套局部 z 刻度，
 *   见 `src/features/canvas/canvasUtils.ts`，不要和这里的全局档位混用。
 * - 组件内部的相互遮挡（如缩略图堆叠顺序）用小数值局部处理即可，不必登记。
 */
export const Z_LAYERS = {
  base: 0,
  raised: 10,
  sticky: 20,
  dropdown: 30,
  panel: 40,
  modal: 50,
  viewer: 60,
  toast: 70,
  tooltip: 80,
  drag: 90,
  titlebar: 100,
} as const;

export type ZLayerName = keyof typeof Z_LAYERS;
