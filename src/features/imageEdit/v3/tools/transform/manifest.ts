import { MoveUpRight, Scan, Grid2X2 } from "lucide-react";
import type { ToolManifest } from "../../toolFramework/toolManifest";
const definitions = [
  {
    id: "free-transform",
    icon: Scan,
    description:
      "自由变换所选图层，缩放、旋转与移动；角点默认等比，Shift 自由缩放或按15度旋转，确认后一次撤销。",
  },
  {
    id: "perspective-transform",
    icon: MoveUpRight,
    description:
      "拖动像素图层四角调整透视，控制点为对象空间比例；原像素保留，可确认或取消。",
  },
  {
    id: "mesh-transform",
    icon: Grid2X2,
    description:
      "拖动像素图层网格控制点变形，拒绝折叠；原像素保留，可确认或取消。",
  },
] as const;
declare module "../../toolFramework/types" {
  interface ImageEditorToolCatalog
    extends Record<(typeof definitions)[number]["id"], true> {}
}
export const toolManifest: readonly ToolManifest[] = definitions.map(
  (definition) => ({
    ...definition,
    labelKey: `imageEditor.v3.tools.${definition.id}`,
    aliases: [definition.id],
    group: {
      id: "transform",
      order: 2,
      collapsed: true,
      triggerId: "free-transform",
    },
    profiles: ["full", "canvas-edit"],
    cursor: "cursor-crosshair",
    input: "overlay",
  }),
);
