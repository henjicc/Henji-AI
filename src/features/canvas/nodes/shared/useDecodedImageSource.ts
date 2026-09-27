import { useEffect, useRef, useState } from 'react';

// 只合并正在进行的同源预解码，不缓存完成状态：浏览器可能随时淘汰解码后的像素。
interface PendingDecode { promise: Promise<void>; users: number }
const pendingDecodes = new Map<string, PendingDecode>();

function predecodeImage(src: string): { promise: Promise<void>; release: () => void } {
  let pending = pendingDecodes.get(src);
  if (!pending) {
    const image = new Image();
    image.src = src;
    const entry = { promise: image.decode(), users: 0 };
    pendingDecodes.set(src, entry);
    const finish = (): void => { if (pendingDecodes.get(src) === entry) pendingDecodes.delete(src); };
    void entry.promise.then(finish, finish);
    pending = entry;
  }
  const retained = pending;
  retained.users += 1;
  let released = false;
  return {
    promise: retained.promise,
    release: () => {
      if (released) return;
      released = true;
      retained.users -= 1;
      // 离开最后一个节点时也释放共享记录，不能把未完成的网络解码永久留在 Map 中。
      if (retained.users === 0 && pendingDecodes.get(src) === retained) pendingDecodes.delete(src);
    },
  };
}

/**
 * 图片源切换时先离屏预解码（Image.decode），解码完成再换显示 src。
 *
 * 用途：LOD 跨阈值时缩略图 ↔ 原图互换，直接改 <img src> 会在渲染帧同步解码大图，
 * 造成 50~80ms 的坏帧（缩放顿挫的主因）。预解码后换 src 的那一帧无需再解码。
 * 解码期间保持显示上一张，不闪空白。
 */
export function useDecodedImageSource(targetSrc: string | null): string | null {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(targetSrc);
  const targetRef = useRef(targetSrc);
  targetRef.current = targetSrc;

  useEffect(() => {
    if (targetSrc === null) {
      setDisplayedSrc(null);
      return;
    }

    let cancelled = false;
    const commit = (): void => {
      if (!cancelled && targetRef.current === targetSrc) {
        setDisplayedSrc(targetSrc);
      }
    };
    // decode 失败（格式不支持等）时也换 src，回退到浏览器绘制时解码的旧行为
    const request = predecodeImage(targetSrc);
    void request.promise.then(commit, commit);

    return () => {
      cancelled = true;
      request.release();
    };
  }, [targetSrc]);

  // 目标为空时立即反映；非空时优先返回已解码的显示源（可能仍是上一张）
  return targetSrc === null ? null : displayedSrc;
}
