import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, UiButton } from "@/components/ui";
import { useImageEditorSessionStoreV3 } from "../../store";
import type { ToolOptionsProps } from "../../toolFramework/types";
import { findImageEditLayerLocationV3 } from "../../editor/layerTreeV3";
import { transformSession } from "./session";
export function TransformOptions({
  controller,
  bus,
}: ToolOptionsProps): JSX.Element {
  const { t } = useTranslation("ui"),
    session = transformSession(bus),
    draft = useSyncExternalStore(session.subscribe, session.snapshot);
  const view = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId],
  );
  const tool = view?.activeTool;
  const layer =
    view?.selectedLayerIds.length === 1
      ? findImageEditLayerLocationV3(
          controller.document.layers,
          view.selectedLayerIds[0],
        )?.layer
      : null;
  const label = (key: string): string => t(`imageEditor.v3.transform.${key}`);
  return (
    <div
      className="flex h-full min-w-max items-center gap-3"
      data-transform-options
    >
      <Dropdown
        size="sm"
        value={tool ?? "free-transform"}
        display={t(`imageEditor.v3.tools.${tool}`)}
        options={[
          "free-transform",
          "perspective-transform",
          "mesh-transform",
        ].map((value) => ({
          value,
          label: t(`imageEditor.v3.tools.${value}`),
        }))}
        onSelect={(value) => {
          session.cancel();
          useImageEditorSessionStoreV3
            .getState()
            .setActiveTool(
              controller.sessionId,
              value as
                | "free-transform"
                | "perspective-transform"
                | "mesh-transform",
            );
        }}
      />
      <UiButton
        size="sm"
        variant="primary"
        disabled={!draft || Boolean(draft.error)}
        onClick={() => session.apply()}
      >
        {label("apply")}
      </UiButton>
      <UiButton size="sm" disabled={!draft} onClick={() => session.cancel()}>
        {label("cancel")}
      </UiButton>
      {layer?.deformation && (
        <UiButton
          size="sm"
          onClick={() => session.preview(layer.id, { deformation: null })}
        >
          {label("restore")}
        </UiButton>
      )}
      <span className="text-xs text-text3">
        {label(
          tool === "free-transform"
            ? "constraints"
            : tool === "perspective-transform"
              ? "perspectiveHint"
              : "meshHint",
        )}
      </span>
    </div>
  );
}
