import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { UiEmpty, UiError, UiPanel } from "@/components/ui";
import {
  composeAffine,
  forwardDeform,
  identityDeformation,
  inverseAffine,
  mapAffine,
  prepareDeformation,
  resizeAffine,
  rotateAffine,
  translateAffine,
  type Affine,
  type Deformation,
  type Point,
} from "@/core/imaging/transforms";
import { useImageEditorSessionStoreV3 } from "../../store";
import { findImageEditLayerLocationV3 } from "../../editor/layerTreeV3";
import { isImageEditLayerTransformableV3 } from "../../editor/layerTransformV3";
import {
  captureEditorPointerV3,
  releaseEditorPointerV3,
  type CapturedEditorPointerV3,
} from "../../editor/pointerCaptureV3";
import type { ToolOverlayContext } from "../../toolFramework/types";
import { transformSession } from "./session";
interface Drag {
  pointer: CapturedEditorPointerV3;
  handle: number | "move" | "rotate" | "pivot";
  start: Point;
  transform: Affine;
  deformation: Deformation | null;
  pivot: Point;
  revision: number;
}
export function TransformOverlay({
  controller,
  bus,
  projectedDocument,
  geometry,
  stageWidth,
  bindKeyboard,
  bindPointerAvailability,
}: ToolOverlayContext): JSX.Element {
  const { t } = useTranslation("ui"),
    view = useImageEditorSessionStoreV3(
      (state) => state.sessions[controller.sessionId],
    );
  const session = transformSession(bus),
    draft = useSyncExternalStore(session.subscribe, session.snapshot),
    svg = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null);
  const [pivot, setPivot] = useState<Point>([0.5, 0.5]);
  const selected =
    view?.selectedLayerIds.length === 1 ? view.selectedLayerIds[0] : null;
  const location = selected
    ? findImageEditLayerLocationV3(projectedDocument.layers, selected)
    : null;
  const mode =
    view?.activeTool === "perspective-transform"
      ? "perspective"
      : view?.activeTool === "mesh-transform"
        ? "mesh"
        : "affine";
  const available =
    isImageEditLayerTransformableV3(location) &&
    (mode === "affine" || location.layer.type === "raster");
  const cancel = useCallback(() => {
    const value = drag.current;
    drag.current = null;
    if (value) releaseEditorPointerV3(value.pointer);
    session.cancel();
  }, [session]);
  useEffect(() => {
    cancel();
    setPivot([0.5, 0.5]);
    return cancel;
  }, [cancel, selected, mode]);
  useEffect(() => {
    const owner = svg.current?.ownerDocument.defaultView;
    owner?.addEventListener("blur", cancel);
    return () => owner?.removeEventListener("blur", cancel);
  }, [cancel, available]);
  useEffect(
    () =>
      bus.subscribe(() => {
        const current = session.snapshot();
        if (current && current.revision !== bus.getSnapshot().document.revision)
          cancel();
      }),
    [bus, cancel, session],
  );
  useEffect(() => {
    const keyboard = bindKeyboard("transform", (event) => {
      if (event.key === "Escape") {
        cancel();
        return true;
      }
      if (event.key === "Enter" && session.snapshot()) {
        session.apply();
        return true;
      }
      return false;
    });
    const pointer = bindPointerAvailability("transform", () => available);
    return () => {
      keyboard();
      pointer();
    };
  }, [available, bindKeyboard, bindPointerAvailability, cancel, session]);
  const label = (key: string): string => t(`imageEditor.v3.transform.${key}`);
  if (!available || !location)
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <UiPanel className="p-3">
          <UiEmpty
            size="sm"
            title={label(mode === "affine" ? "selectLayer" : "selectRaster")}
          />
        </UiPanel>
      </div>
    );
  const width = projectedDocument.geometry.width,
    height = projectedDocument.geometry.height,
    layer = location.layer;
  let parentToOutput: Affine = geometry.sourceToOutput;
  for (const parent of location.ancestors)
    parentToOutput = composeAffine(parentToOutput, parent.transform);
  const deformation = layer.deformation ?? null,
    prepared = prepareDeformation(deformation);
  const baseControls =
    mode === "affine"
      ? identityDeformation("perspective")
      : deformation?.kind === mode
        ? deformation
        : identityDeformation(mode);
  const controlDeformation =
    mode !== "affine" && deformation?.kind !== mode
      ? {
          ...baseControls,
          points: baseControls.points.map((point) =>
            forwardDeform(prepared, point),
          ),
        }
      : baseControls;
  const controls = controlDeformation.points;
  const toParent = (p: Point, transform: Affine = layer.transform): Point =>
    mapAffine(transform, [p[0] * width, p[1] * height]);
  const toOutput = (p: Point): Point => mapAffine(parentToOutput, toParent(p));
  const displayed = controls.map((p) =>
    toOutput(mode === "affine" ? forwardDeform(prepared, p) : p),
  );
  const cornerIndices =
    mode === "mesh"
      ? [
          0,
          (deformation?.kind === "mesh" ? deformation.columns : 3) - 1,
          controls.length - 1,
          controls.length -
            (deformation?.kind === "mesh" ? deformation.columns : 3),
        ]
      : [0, 1, 2, 3];
  const corners = cornerIndices.map((i) => displayed[i]),
    center = toOutput(pivot),
    radius = (6 * geometry.width) / Math.max(1, stageWidth);
  const rotate: Point = [
    (corners[0][0] + corners[1][0]) / 2,
    (corners[0][1] + corners[1][1]) / 2 - radius * 5,
  ];
  const local = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return mapAffine(inverseAffine(parentToOutput), [
      ((event.clientX - rect.left) * geometry.width) / rect.width,
      ((event.clientY - rect.top) * geometry.height) / rect.height,
    ]);
  };
  const down = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    const target = event.target as Element,
      value = target.getAttribute("data-transform-handle");
    if (value === null) return;
    const handle =
      value === "move" || value === "rotate" || value === "pivot"
        ? value
        : Number(value);
    drag.current = {
      pointer: captureEditorPointerV3(event.currentTarget, event.pointerId),
      handle,
      start: local(event),
      transform: layer.transform,
      deformation,
      pivot,
      revision: bus.getSnapshot().document.revision,
    };
    event.preventDefault();
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const value = drag.current;
    if (!value || value.pointer.pointerId !== event.pointerId) return;
    if (value.revision !== bus.getSnapshot().document.revision) {
      cancel();
      return;
    }
    const end = local(event),
      delta: Point = [end[0] - value.start[0], end[1] - value.start[1]];
    if (value.handle === "pivot") {
      const p = mapAffine(inverseAffine(value.transform), end);
      setPivot([p[0] / width, p[1] / height]);
      return;
    }
    try {
      let transform = value.transform,
        next = value.deformation;
      if (value.handle === "move")
        transform = translateAffine(value.transform, delta);
      else if (value.handle === "rotate")
        transform = rotateAffine(
          value.transform,
          toParent(value.pivot, value.transform),
          value.start,
          end,
          event.shiftKey,
        );
      else if (mode === "affine") {
        const original = prepareDeformation(value.deformation);
        const corner = forwardDeform(original, controls[value.handle]),
          opposite = forwardDeform(original, controls[(value.handle + 2) % 4]);
        transform = resizeAffine(
          value.transform,
          [opposite[0] * width, opposite[1] * height],
          [corner[0] * width, corner[1] * height],
          end,
          !event.shiftKey,
        );
      } else {
        const base =
          value.deformation?.kind === mode
            ? value.deformation
            : controlDeformation;
        const p = mapAffine(inverseAffine(value.transform), end);
        next = {
          ...base,
          points: base.points.map((point, i) =>
            i === value.handle
              ? ([p[0] / width, p[1] / height] as Point)
              : point,
          ),
        };
        prepareDeformation(next);
      }
      session.preview(layer.id, { transform, deformation: next });
    } catch (error) {
      session.reject(layer.id, error);
    }
  };
  const up = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const value = drag.current;
    if (!value || value.pointer.pointerId !== event.pointerId) return;
    move(event);
    drag.current = null;
    releaseEditorPointerV3(value.pointer);
  };
  const lines: Point[][] = [];
  if (mode === "mesh") {
    const columns = deformation?.kind === "mesh" ? deformation.columns : 3,
      rows = deformation?.kind === "mesh" ? deformation.rows : 3;
    for (let y = 0; y < rows; y++)
      lines.push(displayed.slice(y * columns, (y + 1) * columns));
    for (let x = 0; x < columns; x++)
      lines.push(
        Array.from({ length: rows }, (_, y) => displayed[y * columns + x]),
      );
  }
  return (
    <>
      {/* icon-token-allow: 文档坐标计算的控制框、透视与网格图形，不是图标。 */}
      <svg
        ref={svg}
        data-transform-overlay
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (drag.current) cancel();
        }}
      >
        <polygon
          points={corners.map((p) => p.join(",")).join(" ")}
          data-transform-handle="move"
          fill="transparent"
          stroke="var(--on-media)"
          vectorEffect="non-scaling-stroke"
          className="pointer-events-auto cursor-move"
        />
        {lines.map((points, i) => (
          <polyline
            key={i}
            points={points.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke="var(--on-media)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {displayed.map(([cx, cy], i) => (
          <circle
            key={i}
            data-transform-handle={i}
            aria-label={label("corner") + ` ${i + 1}`}
            cx={cx}
            cy={cy}
            r={radius}
            fill="var(--media-control)"
            stroke="var(--on-media)"
            vectorEffect="non-scaling-stroke"
            className="pointer-events-auto cursor-crosshair"
          />
        ))}
        {mode === "affine" && (
          <>
            <line
              x1={rotate[0]}
              y1={rotate[1]}
              x2={(corners[0][0] + corners[1][0]) / 2}
              y2={(corners[0][1] + corners[1][1]) / 2}
              stroke="var(--on-media)"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              data-transform-handle="rotate"
              aria-label={label("rotate")}
              cx={rotate[0]}
              cy={rotate[1]}
              r={radius}
              fill="var(--media-control)"
              stroke="var(--on-media)"
              className="pointer-events-auto cursor-crosshair"
            />
            <circle
              data-transform-handle="pivot"
              aria-label={label("pivot")}
              cx={center[0]}
              cy={center[1]}
              r={radius}
              fill="var(--media-control)"
              stroke="var(--on-media)"
              className="pointer-events-auto cursor-crosshair"
            />
          </>
        )}
      </svg>
      {draft?.error && (
        <div className="absolute left-3 top-3">
          <UiPanel className="p-3">
            <UiError
              size="sm"
              title={label("invalid")}
              message={label("recover")}
            />
          </UiPanel>
        </div>
      )}
    </>
  );
}
