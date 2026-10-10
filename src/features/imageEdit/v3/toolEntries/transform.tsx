import { toolManifest } from "../tools/transform/manifest";
import { TransformOptions } from "../tools/transform/TransformOptions";
import { TransformOverlay } from "../tools/transform/TransformOverlay";
import { transformSession } from "../tools/transform/session";
import type { ToolDefinition, ToolOverlaySlot } from "../toolFramework/types";
const overlay: ToolOverlaySlot = {
  id: "transform",
  activeOnly: true,
  requiresLayout: true,
  resetOnCancel: true,
  onCancel: ({ bus }) => transformSession(bus).cancel(),
  render: (context) => <TransformOverlay {...context} />,
};
export const tools: readonly ToolDefinition[] = toolManifest.map(
  (definition) => ({
    ...definition,
    Options: TransformOptions,
    overlays: [overlay],
  }),
);
