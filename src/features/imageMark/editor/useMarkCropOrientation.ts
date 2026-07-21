import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { applyOrientationOpToDoc, clampCropRect, type OrientationOp } from '../domain/geometry';
import type { ImageMarkDoc, MarkCropRect } from '../domain/types';

export interface UseMarkCropOrientationParams {
  docRef: MutableRefObject<ImageMarkDoc>;
  setDoc: Dispatch<SetStateAction<ImageMarkDoc>>;
  onDocChange?: (doc: ImageMarkDoc) => void;
  commitDoc: (next: ImageMarkDoc, recordHistory?: boolean) => void;
  pushHistorySnapshot: (base: ImageMarkDoc) => void;
  imageWidth: number;
  imageHeight: number;
  /** 朝向变化前清理选中/草稿/文字浮层 */
  onBeforeOrientation: () => void;
}

/** 旋转/翻转与裁剪区域管理 */
export function useMarkCropOrientation({
  docRef,
  setDoc,
  onDocChange,
  commitDoc,
  pushHistorySnapshot,
  imageWidth,
  imageHeight,
  onBeforeOrientation,
}: UseMarkCropOrientationParams) {
  const cropGestureBaseRef = useRef<ImageMarkDoc | null>(null);

  const applyOrientation = useCallback((op: OrientationOp) => {
    onBeforeOrientation();
    commitDoc(applyOrientationOpToDoc(docRef.current, imageWidth, imageHeight, op));
  }, [commitDoc, docRef, imageHeight, imageWidth, onBeforeOrientation]);

  const normalizeCrop = useCallback((crop: MarkCropRect | null): MarkCropRect | null => {
    if (!crop) {
      return null;
    }
    const clamped = clampCropRect(crop, imageWidth, imageHeight);
    const coversAll =
      clamped.x <= 0.5 &&
      clamped.y <= 0.5 &&
      clamped.width >= imageWidth - 1 &&
      clamped.height >= imageHeight - 1;
    return coversAll ? null : clamped;
  }, [imageHeight, imageWidth]);

  const ensureCropExists = useCallback(() => {
    if (docRef.current.crop || imageWidth <= 0) {
      return;
    }
    // 初始框 = 全图(等价于不裁剪),只有用户真正拖动后才产生裁剪效果
    const crop: MarkCropRect = { x: 0, y: 0, width: imageWidth, height: imageHeight };
    setDoc((previous) => ({ ...previous, crop }));
  }, [docRef, imageHeight, imageWidth, setDoc]);

  /** 离开裁剪工具时调用:未产生实际裁剪(仍为全图)则静默清掉,不留虚线框 */
  const normalizeCropSilently = useCallback(() => {
    const current = docRef.current.crop;
    if (!current || normalizeCrop(current) !== null) {
      return;
    }
    const next = { ...docRef.current, crop: null };
    setDoc(next);
    onDocChange?.(next);
  }, [docRef, normalizeCrop, onDocChange, setDoc]);

  const handleCropChange = useCallback((crop: MarkCropRect) => {
    if (!cropGestureBaseRef.current) {
      cropGestureBaseRef.current = docRef.current;
    }
    setDoc((previous) => ({ ...previous, crop }));
  }, [docRef, setDoc]);

  const handleCropCommit = useCallback(() => {
    const base = cropGestureBaseRef.current;
    cropGestureBaseRef.current = null;
    const next = { ...docRef.current, crop: normalizeCrop(docRef.current.crop) };
    if (base) {
      pushHistorySnapshot(base);
    }
    setDoc(next);
    onDocChange?.(next);
  }, [docRef, normalizeCrop, onDocChange, pushHistorySnapshot, setDoc]);

  const handleCropReset = useCallback(() => {
    if (!docRef.current.crop) {
      return;
    }
    commitDoc({ ...docRef.current, crop: null });
  }, [commitDoc, docRef]);

  return {
    applyOrientation,
    ensureCropExists,
    normalizeCropSilently,
    handleCropChange,
    handleCropCommit,
    handleCropReset,
  };
}
