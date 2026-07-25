import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ImageMarkDoc, MarkItem } from '../domain/types';
import { HISTORY_LIMIT } from './shared';

export interface UseMarkHistoryParams {
  docRef: React.MutableRefObject<ImageMarkDoc>;
  setDoc: Dispatch<SetStateAction<ImageMarkDoc>>;
  onDocChange?: (doc: ImageMarkDoc) => void;
  /** 撤销/重做后清理选中、草稿、文字浮层 */
  onHistoryNavigate: () => void;
}

export interface MarkHistoryController {
  canUndo: boolean;
  canRedo: boolean;
  pushHistorySnapshot: (base: ImageMarkDoc) => void;
  commitDoc: (next: ImageMarkDoc, recordHistory?: boolean) => void;
  commitItems: (items: MarkItem[], recordHistory?: boolean) => void;
  handleUndo: () => void;
  handleRedo: () => void;
}

/** 文档提交 + 撤销/重做栈(快照上限 HISTORY_LIMIT) */
export function useMarkHistory({ docRef, setDoc, onDocChange, onHistoryNavigate }: UseMarkHistoryParams): MarkHistoryController {
  const [undoStack, setUndoStack] = useState<ImageMarkDoc[]>([]);
  const [redoStack, setRedoStack] = useState<ImageMarkDoc[]>([]);
  const onHistoryNavigateRef = useRef(onHistoryNavigate);
  onHistoryNavigateRef.current = onHistoryNavigate;

  const pushHistorySnapshot = useCallback((base: ImageMarkDoc) => {
    setUndoStack((prev) => [...prev, base].slice(-HISTORY_LIMIT));
    setRedoStack([]);
  }, []);

  const commitDoc = useCallback((next: ImageMarkDoc, recordHistory = true) => {
    if (recordHistory) {
      pushHistorySnapshot(docRef.current);
    }
    setDoc(next);
    onDocChange?.(next);
  }, [docRef, onDocChange, pushHistorySnapshot, setDoc]);

  const commitItems = useCallback((items: MarkItem[], recordHistory = true) => {
    commitDoc({ ...docRef.current, items }, recordHistory);
  }, [commitDoc, docRef]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) {
      return;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((redo) => [...redo, docRef.current].slice(-HISTORY_LIMIT));
    setDoc(previous);
    onDocChange?.(previous);
    onHistoryNavigateRef.current();
  }, [docRef, onDocChange, setDoc, undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) {
      return;
    }
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((undo) => [...undo, docRef.current].slice(-HISTORY_LIMIT));
    setDoc(next);
    onDocChange?.(next);
    onHistoryNavigateRef.current();
  }, [docRef, onDocChange, redoStack, setDoc]);

  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    pushHistorySnapshot,
    commitDoc,
    commitItems,
    handleUndo,
    handleRedo,
  };
}
