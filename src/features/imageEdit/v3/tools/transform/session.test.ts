import { describe, expect, it } from "vitest";
import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from "@/core/imageEdit/v3/documentFactory";
import {
  parseImageEditDocumentV3,
  stringifyImageEditDocumentV3,
} from "@/core/imageEdit/v3/documentCodec";
import { identityDeformation } from "@/core/imaging/transforms";
import { ImageEditCommandBusV3 } from "../../application/imageEditCommandBus";
import { projectImageEditorPreviewDocumentV3 } from "../../execution/previewDocumentV3";
import { transformSession } from "./session";
function open() {
  const doc = createImageEditDocumentV3({ width: 32, height: 24 });
  doc.layers = [createImageEditRasterLayerV3("pixel", "像素")];
  const bus = new ImageEditCommandBusV3(doc);
  return { bus, session: transformSession(bus) };
}
describe("自由变换单一预览事务", () => {
  it("连续控制点预览不改文档；一次应用、撤销、重做与保存回读保留原像素", () => {
    const { bus, session } = open(),
      source = bus.getSnapshot().document.layers[0];
    for (let i = 0; i < 20; i++)
      session.preview("pixel", {
        transform: [1, 0, 0, 1, i, 0],
        deformation: identityDeformation("mesh"),
      });
    expect(bus.getSnapshot().document.revision).toBe(0);
    expect(
      projectImageEditorPreviewDocumentV3(bus.getSnapshot()).layers[0]
        .transform[4],
    ).toBe(19);
    session.apply();
    expect(bus.getSnapshot().document.revision).toBe(1);
    expect(bus.getSnapshot().document.layers[0]).toMatchObject({
      source: source.type === "raster" ? source.source : undefined,
      tiles: {},
    });
    const parsed = parseImageEditDocumentV3(
      stringifyImageEditDocumentV3(bus.getSnapshot().document),
    );
    expect(parsed.layers[0].deformation).toEqual(identityDeformation("mesh"));
    bus.undo();
    expect(bus.getSnapshot().document.layers[0].deformation ?? null).toBeNull();
    bus.redo();
    expect(bus.getSnapshot().document.layers[0].deformation).toEqual(
      identityDeformation("mesh"),
    );
  });
  it("取消保留redo；非法网格不能应用；修正后才提交", () => {
    const { bus, session } = open();
    session.preview("pixel", { transform: [1, 0, 0, 1, 3, 0] });
    session.apply();
    bus.undo();
    session.preview("pixel", {
      deformation: identityDeformation("perspective"),
    });
    session.cancel();
    expect(bus.getSnapshot().history.redoCount).toBe(1);
    session.preview("pixel", {
      deformation: {
        kind: "perspective",
        points: [
          [0, 0],
          [0, 0],
          [1, 1],
          [0, 1],
        ],
      },
    });
    expect(session.snapshot()?.error).toBeTruthy();
    session.apply();
    expect(bus.getSnapshot().document.layers[0].deformation ?? null).toBeNull();
    session.preview("pixel", { deformation: identityDeformation("mesh") });
    session.apply();
    expect(bus.getSnapshot().document.layers[0].deformation?.kind).toBe("mesh");
  });
});
