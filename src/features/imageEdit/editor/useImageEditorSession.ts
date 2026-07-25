import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createImageEditOperation,
  createEmptyImageEditDocument,
  getImageEditOperation,
  imageEditDocumentToMarkDoc,
  imageEditOperationRegistry,
  replaceMarkDocInImageEditDocument,
  upsertImageEditOperation,
  type ImageEditDocument,
  type ImageEditOperation,
  type ImageMarkDoc,
} from '@/core/imageEdit';
import type { ImageEditDocumentController } from './ImageEditorDocumentContext';
import type { MarkEditorDocumentController } from '@/features/imageMark/editor/MarkEditor';
import type { MarkHistoryController } from '@/features/imageMark/editor/useMarkHistory';
import { HISTORY_LIMIT } from '@/features/imageMark/editor/shared';

export interface UseImageEditorSessionParams {
  initialDocument?: ImageEditDocument | null;
  onDocumentChange?: (document: ImageEditDocument) => void;
}

export interface ImageEditorSession {
  document: ImageEditDocument;
  markDoc: ImageMarkDoc;
  markController: MarkEditorDocumentController;
  documentController: ImageEditDocumentController;
}

export function useImageEditorSession({
  initialDocument,
  onDocumentChange,
}: UseImageEditorSessionParams): ImageEditorSession {
  const [document, setDocument] = useState<ImageEditDocument>(() => initialDocument ?? createEmptyImageEditDocument());
  const documentRef = useRef(document);
  documentRef.current = document;
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;
  const [undoStack, setUndoStack] = useState<ImageEditDocument[]>([]);
  const [redoStack, setRedoStack] = useState<ImageEditDocument[]>([]);
  const transactionBaseRef = useRef<ImageEditDocument | null>(null);

  const setMarkDoc = useCallback<Dispatch<SetStateAction<ImageMarkDoc>>>((updater) => {
    setDocument((previous) => {
      const previousMarkDoc = imageEditDocumentToMarkDoc(previous);
      const nextMarkDoc = typeof updater === 'function' ? updater(previousMarkDoc) : updater;
      return replaceMarkDocInImageEditDocument(previous, nextMarkDoc);
    });
  }, []);

  const pushHistorySnapshot = useCallback((base: ImageEditDocument) => {
    setUndoStack((previous) => [...previous, base].slice(-HISTORY_LIMIT));
    setRedoStack([]);
  }, []);

  const pushMarkHistorySnapshot = useCallback((base: ImageMarkDoc) => {
    pushHistorySnapshot(replaceMarkDocInImageEditDocument(documentRef.current, base));
  }, [pushHistorySnapshot]);

  const commitDocument = useCallback((next: ImageEditDocument, recordHistory = true) => {
    if (recordHistory) pushHistorySnapshot(documentRef.current);
    documentRef.current = next;
    setDocument(next);
    onDocumentChangeRef.current?.(next);
  }, [pushHistorySnapshot]);

  const updateDocumentWithoutHistory = useCallback((next: ImageEditDocument) => {
    documentRef.current = next;
    setDocument(next);
    onDocumentChangeRef.current?.(next);
  }, []);

  const commitMarkDoc = useCallback((next: ImageMarkDoc, recordHistory = true) => {
    commitDocument(replaceMarkDocInImageEditDocument(documentRef.current, next), recordHistory);
  }, [commitDocument]);

  const commitMarkItems = useCallback((items: ImageMarkDoc['items'], recordHistory = true) => {
    commitMarkDoc({ ...imageEditDocumentToMarkDoc(documentRef.current), items }, recordHistory);
  }, [commitMarkDoc]);

  const handleUndo = useCallback(() => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    const current = documentRef.current;
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((redo) => [...redo, current].slice(-HISTORY_LIMIT));
    documentRef.current = previous;
    setDocument(previous);
    onDocumentChangeRef.current?.(previous);
  }, [undoStack]);

  const handleRedo = useCallback(() => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    const current = documentRef.current;
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((undo) => [...undo, current].slice(-HISTORY_LIMIT));
    documentRef.current = next;
    setDocument(next);
    onDocumentChangeRef.current?.(next);
  }, [redoStack]);

  const history = useMemo<MarkHistoryController>(() => ({
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    pushHistorySnapshot: pushMarkHistorySnapshot,
    commitDoc: commitMarkDoc,
    commitItems: commitMarkItems,
    handleUndo,
    handleRedo,
  }), [commitMarkDoc, commitMarkItems, handleRedo, handleUndo, pushMarkHistorySnapshot, redoStack.length, undoStack.length]);

  const notifyMarkDocChange = useCallback((next: ImageMarkDoc) => {
    const nextDocument = replaceMarkDocInImageEditDocument(documentRef.current, next);
    documentRef.current = nextDocument;
    setDocument(nextDocument);
    onDocumentChangeRef.current?.(nextDocument);
  }, []);

  const markDoc = useMemo(() => imageEditDocumentToMarkDoc(document), [document]);
  const markController = useMemo<MarkEditorDocumentController>(() => ({
    doc: markDoc,
    setDoc: setMarkDoc,
    onDocChange: notifyMarkDocChange,
    history,
  }), [history, markDoc, notifyMarkDocChange, setMarkDoc]);

  const beginTransaction = useCallback(() => {
    if (!transactionBaseRef.current) {
      transactionBaseRef.current = documentRef.current;
    }
  }, []);

  const commitTransaction = useCallback(() => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (base && base !== documentRef.current) {
      pushHistorySnapshot(base);
    }
  }, [pushHistorySnapshot]);

  const cancelTransaction = useCallback(() => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (base) updateDocumentWithoutHistory(base);
  }, [updateDocumentWithoutHistory]);

  const updateOperation = useCallback<ImageEditDocumentController['updateOperation']>((operationId, update) => {
    const definition = imageEditOperationRegistry.get(operationId);
    if (!definition) throw new Error(`未注册的图片编辑操作：${operationId}`);
    const current = getImageEditOperation(documentRef.current, operationId);
    const currentParams = (current?.params ?? definition.createDefaultParams()) as object;
    const updateParams = update as unknown as (params: object) => object;
    const nextParams = definition.parseParams(updateParams(currentParams));
    const nextOperation: ImageEditOperation = current
      ? { ...current, params: nextParams }
      : createImageEditOperation(operationId, nextParams);
    const nextDocument = upsertImageEditOperation(documentRef.current, nextOperation);
    if (transactionBaseRef.current) {
      updateDocumentWithoutHistory(nextDocument);
      return;
    }
    commitDocument(nextDocument);
  }, [commitDocument, updateDocumentWithoutHistory]);

  const setOperationEnabled = useCallback((operationId: string, enabled: boolean) => {
    const current = getImageEditOperation(documentRef.current, operationId);
    if (!current) {
      if (!enabled) return;
      updateOperation(operationId, (params) => params);
      return;
    }
    const nextDocument = upsertImageEditOperation(documentRef.current, { ...current, enabled });
    if (transactionBaseRef.current) updateDocumentWithoutHistory(nextDocument);
    else commitDocument(nextDocument);
  }, [commitDocument, updateDocumentWithoutHistory, updateOperation]);

  const resetOperation = useCallback((operationId: string) => {
    const definition = imageEditOperationRegistry.get(operationId);
    if (!definition) throw new Error(`未注册的图片编辑操作：${operationId}`);
    const current = getImageEditOperation(documentRef.current, operationId);
    const nextOperation: ImageEditOperation = current
      ? { ...current, enabled: true, params: definition.createDefaultParams() }
      : createImageEditOperation(operationId, definition.createDefaultParams());
    const nextDocument = upsertImageEditOperation(documentRef.current, nextOperation);
    if (transactionBaseRef.current) updateDocumentWithoutHistory(nextDocument);
    else commitDocument(nextDocument);
  }, [commitDocument, updateDocumentWithoutHistory]);

  const removeOperation = useCallback((operationId: string) => {
    const nextDocument = {
      ...documentRef.current,
      operations: documentRef.current.operations.filter((operation) => operation.operationId !== operationId),
    };
    if (nextDocument.operations.length === documentRef.current.operations.length) return;
    if (transactionBaseRef.current) updateDocumentWithoutHistory(nextDocument);
    else commitDocument(nextDocument);
  }, [commitDocument, updateDocumentWithoutHistory]);

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

  return { document, markDoc, markController, documentController };
}
