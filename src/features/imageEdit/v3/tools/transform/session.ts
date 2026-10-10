import { createLogger } from "@/core/logging";
import { normalizeImageEditLayerCommonPatchV3 } from "@/core/imageEdit/v3/commandCommonPatch";
import { createImageEditIdV3 } from "@/core/imageEdit/v3/documentFactory";
import type { ImageEditLayerCommonPatchV3 } from "@/core/imageEdit/v3/commandTypes";
import type { ImageEditCommandBusV3 } from "../../application/imageEditCommandBus";

const logger = createLogger("imageEdit.transform");
export interface TransformDraft {
  layerId: string;
  revision: number;
  patch: ImageEditLayerCommonPatchV3;
  error: string | null;
}
/** One preview transaction in the existing bus; no pixels, persistence or second history here. */
export class TransformSession {
  private draft: TransformDraft | null = null;
  private listeners = new Set<() => void>();
  readonly previewId = createImageEditIdV3("transform-preview");
  constructor(private readonly bus: ImageEditCommandBusV3) {}
  readonly snapshot = (): TransformDraft | null => this.draft;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
  preview(layerId: string, patch: ImageEditLayerCommonPatchV3): void {
    const revision = this.bus.getSnapshot().document.revision;
    if (
      this.draft &&
      (this.draft.layerId !== layerId || this.draft.revision !== revision)
    )
      this.cancel();
    try {
      const parsed = normalizeImageEditLayerCommonPatchV3(patch);
      this.bus.setPreview({
        id: this.previewId,
        kind: "parameter",
        targetId: layerId,
        baseRevision: revision,
        value: parsed,
      });
      this.draft = { layerId, revision, patch: parsed, error: null };
    } catch (error) {
      logger.warn("变换预览被拒绝", error, {
        event: "image_edit.transform.preview.rejected",
        layerId,
        revision,
      });
      this.draft = {
        layerId,
        revision,
        patch: this.draft?.patch ?? {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.emit();
  }
  reject(layerId: string, error: unknown): void {
    if (!this.draft?.error)
      logger.warn("变换预览被拒绝", error, {
        event: "image_edit.transform.preview.rejected",
        layerId,
        revision: this.bus.getSnapshot().document.revision,
      });
    this.draft = {
      layerId,
      revision: this.bus.getSnapshot().document.revision,
      patch: this.draft?.patch ?? {},
      error: error instanceof Error ? error.message : String(error),
    };
    this.emit();
  }
  apply(): void {
    const draft = this.draft;
    if (!draft || draft.error) return;
    try {
      this.bus.commitPreview(this.previewId, {
        commandId: createImageEditIdV3("transform"),
        expectedRevision: draft.revision,
        type: "layer.update-common",
        layerId: draft.layerId,
        patch: draft.patch,
      });
      this.draft = null;
    } catch (error) {
      logger.error("变换应用失败", error, {
        event: "image_edit.transform.apply.failed",
        layerId: draft.layerId,
        revision: draft.revision,
      });
      this.draft = {
        ...draft,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.emit();
  }
  cancel(): void {
    this.bus.clearPreview(this.previewId);
    this.draft = null;
    this.emit();
  }
}
const sessions = new WeakMap<ImageEditCommandBusV3, TransformSession>();
export function transformSession(bus: ImageEditCommandBusV3): TransformSession {
  let session = sessions.get(bus);
  if (!session) {
    session = new TransformSession(bus);
    sessions.set(bus, session);
  }
  return session;
}
