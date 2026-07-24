import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createEmptyImageEditDocument,
  imageEditDocumentToMarkDoc,
  replaceMarkDocInImageEditDocument,
  type ImageEditDocument,
  type ImageMarkDoc,
} from '@/core/imageEdit';
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

  return { document, markDoc, markController };
}
