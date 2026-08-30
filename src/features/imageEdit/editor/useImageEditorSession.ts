import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  createImageEditOperation,
  createEmptyImageEditDocument,
  getImageEditOperation,
  imageEditDocumentToMarkDoc,
  imageEditOperationRegistry,
  replaceMarkDocInImageEditDocument,
  upsertImageEditOperationWithExclusivity,
  type ImageEditDocument,
  type ImageEditOperation,
  type ImageMarkDoc,
} from '@/core/imageEdit';
import { useImageEditSessionStore } from '../store/imageEditSessionStore';
import type { ImageEditDocumentController } from './ImageEditorDocumentContext';
import type { MarkEditorDocumentController } from '@/features/imageMark/editor/MarkEditor';
import type { MarkHistoryController } from '@/features/imageMark/editor/useMarkHistory';

export interface UseImageEditorSessionParams {
  initialDocument?: ImageEditDocument | null;
  onDocumentChange?: (document: ImageEditDocument) => void;
}

export interface ImageEditorSession {
  document: ImageEditDocument;
  markDoc: ImageMarkDoc;
  markController: MarkEditorDocumentController;
  documentController: ImageEditDocumentController;
  /** 这个编辑器实例在 imageEditSessionStore 里的分片 key（6.2 用它把助手能力接到具体会话）。 */
  sessionId: string;
}

/**
 * 图片编辑会话的薄适配层（6.1）：真正的状态搬进了 imageEditSessionStore，按 sessionId
 * 分片——三个宿主（工具箱 / 画布 Viewer / 画布编辑工具）都通过 ImageEditor.tsx 调用这个
 * hook，每次挂载各自生成一个稳定 sessionId，天然互不干扰，同时开几个都没问题。
 *
 * 对外返回的 ImageEditorSession 形状一字不改（只新增了 sessionId 字段，是纯增量，不影响
 * 现有唯一消费方 ImageEditor.tsx 的解构写法）。reducer 逻辑仍然全部委托给
 * @/core/imageEdit/document.ts 的纯函数，这里只负责把它们接到 store 的读写上。
 */
export function useImageEditorSession({
  initialDocument,
  onDocumentChange,
}: UseImageEditorSessionParams): ImageEditorSession {
  const sessionIdRef = useRef<string>();
  if (!sessionIdRef.current) {
    sessionIdRef.current = `image-edit-session:${globalThis.crypto.randomUUID()}`;
    // 在渲染期间（不是 effect 里）建立会话：首帧就要能读到正确的初始文档，不能等 effect
    // 跑完才补上，否则会有一帧空文档的闪烁。ensureSession 是幂等的，StrictMode 下的
    // 重复渲染安全。
    useImageEditSessionStore.getState().ensureSession(sessionIdRef.current, initialDocument ?? undefined);
  }
  const sessionId = sessionIdRef.current;

  useEffect(() => () => {
    useImageEditSessionStore.getState().disposeSession(sessionId);
  }, [sessionId]);

  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;

  const document = useImageEditSessionStore(
    (state) => state.sessions[sessionId]?.document ?? initialDocument ?? createEmptyImageEditDocument()
  );
  /*
   * 读 store 现值，不维护一份 useRef 镜像——同一个 act()/事件处理函数里可能连续调用好几次
   * updateOperation（柔光滑杆的事务式更新就是这样，见下面 beginTransaction 那组测试），
   * zustand 的 set() 是同步落地的，但 React 的重渲染不是；如果像原来 useState 版本那样
   * 只在渲染期间同步一次 ref，两次连续调用之间 ref 还是旧值，第二次调用会用陈旧的
   * documentRef.current 算出错误结果。直接读 store 保证每次都拿到最新值。
   */
  const currentDocument = useCallback((): ImageEditDocument => (
    useImageEditSessionStore.getState().sessions[sessionId]?.document ?? initialDocument ?? createEmptyImageEditDocument()
  ), [initialDocument, sessionId]);
  const canUndo = useImageEditSessionStore((state) => (state.sessions[sessionId]?.undoStack.length ?? 0) > 0);
  const canRedo = useImageEditSessionStore((state) => (state.sessions[sessionId]?.redoStack.length ?? 0) > 0);

  const transactionBaseRef = useRef<ImageEditDocument | null>(null);

  const pushHistorySnapshot = useCallback((base: ImageEditDocument) => {
    useImageEditSessionStore.getState().pushHistorySnapshot(sessionId, base);
  }, [sessionId]);

  const commitDocument = useCallback((next: ImageEditDocument, recordHistory = true) => {
    useImageEditSessionStore.getState().commitDocument(sessionId, next, recordHistory);
    onDocumentChangeRef.current?.(next);
  }, [sessionId]);

  const updateDocumentWithoutHistory = useCallback((next: ImageEditDocument) => {
    useImageEditSessionStore.getState().updateDocumentWithoutHistory(sessionId, next);
    onDocumentChangeRef.current?.(next);
  }, [sessionId]);

  const setMarkDoc = useCallback<Dispatch<SetStateAction<ImageMarkDoc>>>((updater) => {
    const previousMarkDoc = imageEditDocumentToMarkDoc(currentDocument());
    const nextMarkDoc = typeof updater === 'function' ? updater(previousMarkDoc) : updater;
    updateDocumentWithoutHistory(replaceMarkDocInImageEditDocument(currentDocument(), nextMarkDoc));
  }, [currentDocument, updateDocumentWithoutHistory]);

  const pushMarkHistorySnapshot = useCallback((base: ImageMarkDoc) => {
    pushHistorySnapshot(replaceMarkDocInImageEditDocument(currentDocument(), base));
  }, [currentDocument, pushHistorySnapshot]);

  const commitMarkDoc = useCallback((next: ImageMarkDoc, recordHistory = true) => {
    commitDocument(replaceMarkDocInImageEditDocument(currentDocument(), next), recordHistory);
  }, [commitDocument, currentDocument]);

  const commitMarkItems = useCallback((items: ImageMarkDoc['items'], recordHistory = true) => {
    commitMarkDoc({ ...imageEditDocumentToMarkDoc(currentDocument()), items }, recordHistory);
  }, [commitMarkDoc, currentDocument]);

  const handleUndo = useCallback(() => {
    const previous = useImageEditSessionStore.getState().undo(sessionId);
    if (previous) onDocumentChangeRef.current?.(previous);
  }, [sessionId]);

  const handleRedo = useCallback(() => {
    const next = useImageEditSessionStore.getState().redo(sessionId);
    if (next) onDocumentChangeRef.current?.(next);
  }, [sessionId]);

  const history = useMemo<MarkHistoryController>(() => ({
    canUndo,
    canRedo,
    pushHistorySnapshot: pushMarkHistorySnapshot,
    commitDoc: commitMarkDoc,
    commitItems: commitMarkItems,
    handleUndo,
    handleRedo,
  }), [canRedo, canUndo, commitMarkDoc, commitMarkItems, handleRedo, handleUndo, pushMarkHistorySnapshot]);

  const notifyMarkDocChange = useCallback((next: ImageMarkDoc) => {
    updateDocumentWithoutHistory(replaceMarkDocInImageEditDocument(currentDocument(), next));
  }, [currentDocument, updateDocumentWithoutHistory]);

  const markDoc = useMemo(() => imageEditDocumentToMarkDoc(document), [document]);
  const markController = useMemo<MarkEditorDocumentController>(() => ({
    doc: markDoc,
    setDoc: setMarkDoc,
    onDocChange: notifyMarkDocChange,
    history,
  }), [history, markDoc, notifyMarkDocChange, setMarkDoc]);

  const beginTransaction = useCallback(() => {
    if (!transactionBaseRef.current) {
      transactionBaseRef.current = currentDocument();
    }
  }, [currentDocument]);

  const commitTransaction = useCallback(() => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (base && base !== currentDocument()) {
      pushHistorySnapshot(base);
    }
  }, [currentDocument, pushHistorySnapshot]);

  const cancelTransaction = useCallback(() => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (base) updateDocumentWithoutHistory(base);
  }, [updateDocumentWithoutHistory]);

  const updateOperation = useCallback<ImageEditDocumentController['updateOperation']>((operationId, update) => {
    const definition = imageEditOperationRegistry.get(operationId);
    if (!definition) throw new Error(`未注册的图片编辑操作：${operationId}`);
    const current = getImageEditOperation(currentDocument(), operationId);
    const currentParams = (current?.params ?? definition.createDefaultParams()) as object;
    const updateParams = update as unknown as (params: object) => object;
    const nextParams = definition.parseParams(updateParams(currentParams));
    const nextOperation: ImageEditOperation = current
      ? { ...current, params: nextParams }
      : createImageEditOperation(operationId, nextParams);
    const nextDocument = upsertImageEditOperationWithExclusivity(currentDocument(), nextOperation);
    if (transactionBaseRef.current) {
      updateDocumentWithoutHistory(nextDocument);
      return;
    }
    commitDocument(nextDocument);
  }, [commitDocument, currentDocument, updateDocumentWithoutHistory]);

  const setOperationEnabled = useCallback((operationId: string, enabled: boolean) => {
    const current = getImageEditOperation(currentDocument(), operationId);
    if (!current) {
      if (!enabled) return;
      updateOperation(operationId, (params) => params);
      return;
    }
    const nextDocument = upsertImageEditOperationWithExclusivity(
      currentDocument(),
      { ...current, enabled },
    );
    if (transactionBaseRef.current) updateDocumentWithoutHistory(nextDocument);
    else commitDocument(nextDocument);
  }, [commitDocument, currentDocument, updateDocumentWithoutHistory, updateOperation]);

  const resetOperation = useCallback((operationId: string) => {
    const definition = imageEditOperationRegistry.get(operationId);
    if (!definition) throw new Error(`未注册的图片编辑操作：${operationId}`);
    const current = getImageEditOperation(currentDocument(), operationId);
    const nextOperation: ImageEditOperation = current
      ? { ...current, enabled: true, params: definition.createDefaultParams() }
      : createImageEditOperation(operationId, definition.createDefaultParams());
    const nextDocument = upsertImageEditOperationWithExclusivity(currentDocument(), nextOperation);
    if (transactionBaseRef.current) updateDocumentWithoutHistory(nextDocument);
    else commitDocument(nextDocument);
  }, [commitDocument, currentDocument, updateDocumentWithoutHistory]);

  const removeOperation = useCallback((operationId: string) => {
    const base = currentDocument();
    const nextDocument = {
      ...base,
      operations: base.operations.filter((operation) => operation.operationId !== operationId),
    };
    if (nextDocument.operations.length === base.operations.length) return;
    if (transactionBaseRef.current) updateDocumentWithoutHistory(nextDocument);
    else commitDocument(nextDocument);
  }, [commitDocument, currentDocument, updateDocumentWithoutHistory]);

  const documentController = useMemo<ImageEditDocumentController>(() => ({
    document,
    getOperation: (operationId) => getImageEditOperation(document, operationId),
    beginTransaction,
    updateOperation,
    setOperationEnabled,
    resetOperation,
    removeOperation,
    commitTransaction,
    cancelTransaction,
  }), [beginTransaction, cancelTransaction, commitTransaction, document, removeOperation, resetOperation, setOperationEnabled, updateOperation]);

  return { document, markDoc, markController, documentController, sessionId };
}
