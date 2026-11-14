import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { canvasStoreAttachment } from '@/stores/canvasStore';

/**
 * 节点界面状态：只属于界面、不进画布文档，但要跨正文卸载保留的状态（遮罩撤销栈、画笔设置、选中的视角、
 * 播放位置、滚动位置等）。大画布上正文随视口挂上卸下，组件里的状态会随之丢失，所以放在这里。
 *
 * 按画布 store 分开存：每份打开的画布有自己的 store，画布关闭、store 被丢弃时这里的状态随之回收，
 * 不跨画布、不跨打开次数。节点被删除后它的状态留到画布关闭（撤销删除时还用得上）。
 *
 * 存进来的值是“上次离开时的样子”，取用方负责判断它对当前节点数据是否仍然成立（源图换了、数据被撤销等）。
 */

type SlotMap = Map<string, { value: unknown }>;
const slotsByCanvas = new WeakMap<object, SlotMap>();

function slotsOf(store: object): SlotMap {
  let slots = slotsByCanvas.get(store);
  if (!slots) {
    slots = new Map();
    slotsByCanvas.set(store, slots);
  }
  return slots;
}

function slotKey(nodeId: string, slot: string): string {
  return `${nodeId}\u0000${slot}`;
}

function resolveInitial<T>(initial: T | (() => T)): T {
  return typeof initial === 'function' ? (initial as () => T)() : initial;
}

/** 当前画布上某个节点的一格状态：跨挂载共享的同一个可变盒子。 */
function canvasNodeUiSlot<T>(nodeId: string, slot: string, initial: T | (() => T)): { value: T } {
  const slots = slotsOf(canvasStoreAttachment.getStore());
  const key = slotKey(nodeId, slot);
  let entry = slots.get(key);
  if (!entry) {
    entry = { value: resolveInitial(initial) };
    slots.set(key, entry);
  }
  return entry as { value: T };
}

/**
 * 跨卸载保留的 ref：同一画布上同一节点的同一格每次挂载拿到同一个对象。
 * nodeId 为空（编辑器不在画布节点里，如弹窗）时退回普通 ref。
 */
export function useCanvasNodeUiRef<T>(nodeId: string | null | undefined, slot: string, initial: T): MutableRefObject<T> {
  const local = useRef(initial);
  const [shared] = useState(() => {
    if (!nodeId) return null;
    const entry = canvasNodeUiSlot<T>(nodeId, slot, initial);
    // 与 MutableRefObject 同形：读写 current 就是读写格子里的值
    return {
      get current() { return entry.value; },
      set current(value: T) { entry.value = value; },
    } as MutableRefObject<T>;
  });
  return shared ?? local;
}

/**
 * 跨卸载保留的 useState：卸载前的最后一个值在下次挂载时作为初始值。
 * nodeId 为空时就是普通 useState。
 */
export function useCanvasNodeUiState<T>(
  nodeId: string | null | undefined,
  slot: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const ref = useCanvasNodeUiRef<T | undefined>(nodeId, slot, undefined);
  const [value, setValue] = useState<T>(() => (ref.current !== undefined ? ref.current : resolveInitial(initial)));
  ref.current = value;
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setValue((previous) => {
      const resolved = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      ref.current = resolved;
      return resolved;
    });
  }, [ref]);
  return [value, set];
}

/** 组件卸载时把 read() 的结果存进 ref（滚动位置这类不随渲染更新的值）；在元素移出文档之前读。 */
export function useSaveOnUnmount<T>(ref: MutableRefObject<T>, read: () => T | undefined): void {
  const readRef = useRef(read);
  readRef.current = read;
  useLayoutEffect(() => () => {
    const value = readRef.current();
    if (value !== undefined) ref.current = value;
  }, [ref]);
}
