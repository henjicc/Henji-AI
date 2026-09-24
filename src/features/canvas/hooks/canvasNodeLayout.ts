import type { ReactFlowState } from '@xyflow/react';

type LayoutState = Pick<ReactFlowState, 'domNode' | 'nodeLookup' | 'width' | 'height' | 'transform' | 'updateNodeInternals'>;
interface Source { getState(): LayoutState; subscribe(listener: () => void): () => void }
interface Entry {
  id: string;
  element: HTMLDivElement;
  header: HTMLElement | null;
  model: object | undefined;
  lease: number;
  suspended: boolean;
  expanded: boolean;
}

const measurementResumes = new WeakMap<HTMLElement, () => void>();
const ATTRIBUTE = 'data-canvas-layout-suspended';

/** 端口测量仍走官方入口；先唤醒布局，不能把隐藏 DOM 的零尺寸交给测量器。 */
export function resumeCanvasNodeMeasurement(element: HTMLElement): void {
  measurementResumes.get(element)?.();
}

export function createCanvasNodeLayout(source: Source): () => void {
  let root: HTMLElement | null = null;
  let observer: MutationObserver | undefined;
  let frame: number | null = null;
  let disposed = false;
  let frameNumber = 0;
  let keyboardNavigation = false;
  let previousTransform: readonly number[] | undefined;
  const entries = new Map<string, Entry>();
  const headers = new Map<string, HTMLElement>();
  const measurements = new Set<Entry>();

  function schedule(): void {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      frameNumber++;
      const updates: Parameters<LayoutState['updateNodeInternals']>[0] = new Map();
      for (const entry of measurements) {
        if (entry.element.isConnected && !entry.suspended) updates.set(entry.id, { id: entry.id, nodeElement: entry.element, force: true });
      }
      measurements.clear();
      if (updates.size) source.getState().updateNodeInternals(updates, { triggerFitView: false });
      reconcile();
    });
  }

  function reveal(entry: Entry): void {
    if (!entry.suspended) return;
    entry.element.removeAttribute(ATTRIBUTE);
    entry.header?.removeAttribute(ATTRIBUTE);
    entry.suspended = false;
  }

  function keepForMeasurement(entry: Entry, force: boolean): void {
    reveal(entry);
    entry.lease = frameNumber + 2;
    if (force) measurements.add(entry);
    schedule();
  }

  function register(element: HTMLDivElement): void {
    const id = element.dataset.id;
    if (!id || entries.get(id)?.element === element) return;
    const previous = entries.get(id);
    if (previous) { reveal(previous); measurementResumes.delete(previous.element); }
    const entry: Entry = { id, element, header: headers.get(id) ?? null, model: undefined, lease: frameNumber + 2, suspended: false,
      expanded: Boolean(element.querySelector('[aria-expanded="true"]')) };
    entries.set(id, entry);
    measurementResumes.set(element, () => keepForMeasurement(entry, false));
  }

  function registerHeader(element: Element): void {
    const surface = element.matches('[data-node-header-drag-surface]') ? element : element.querySelector('[data-node-header-drag-surface]');
    if (!(surface instanceof HTMLElement) || !surface.parentElement) return;
    const id = surface.dataset.nodeHeaderDragSurface;
    if (!id) return;
    headers.set(id, surface.parentElement);
    const entry = entries.get(id);
    if (!entry) return;
    entry.header = surface.parentElement;
    if (entry.suspended) entry.header.setAttribute(ATTRIBUTE, 'true');
  }

  function clearRoot(): void {
    observer?.disconnect(); observer = undefined;
    entries.forEach(entry => { reveal(entry); measurementResumes.delete(entry.element); });
    entries.clear(); headers.clear(); measurements.clear(); root = null;
  }

  function attach(nextRoot: HTMLElement | null): void {
    if (nextRoot === root) return;
    clearRoot(); root = nextRoot;
    if (!root) return;
    root.querySelectorAll<HTMLDivElement>('.react-flow__node').forEach(register);
    root.querySelectorAll('[data-node-header-drag-surface]').forEach(registerHeader);
    observer = new MutationObserver(records => {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        const nodeElement = target?.closest<HTMLElement>('.react-flow__node');
        const entry = nodeElement ? entries.get(nodeElement.dataset.id ?? '') : undefined;
        if (entry) {
          if (record.type === 'attributes') entry.expanded = Boolean(entry.element.querySelector('[aria-expanded="true"]'));
          keepForMeasurement(entry, true);
        }
        record.addedNodes.forEach(node => {
          if (!(node instanceof HTMLDivElement)) return;
          if (node.matches('.react-flow__node')) register(node);
          if (target?.matches('.react-flow__viewport-portal')) registerHeader(node);
        });
        record.removedNodes.forEach(node => {
          if (!(node instanceof HTMLElement) || !node.matches('.react-flow__node')) return;
          const removed = entries.get(node.dataset.id ?? '');
          if (removed?.element !== node) return;
          reveal(removed); measurementResumes.delete(node); measurements.delete(removed); entries.delete(removed.id); headers.delete(removed.id);
        });
      }
      schedule();
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
  }

  function reconcile(): void {
    if (disposed) return;
    const state = source.getState();
    attach(state.domNode);
    if (!root || !state.width || !state.height) return;
    const [x, y, zoom] = state.transform;
    const parents = new Set<string>();
    for (const node of state.nodeLookup.values()) if (node.parentId) parents.add(node.parentId);
    let needsFrame = false;
    const focused = root.ownerDocument.activeElement;
    for (const entry of entries.values()) {
      const node = state.nodeLookup.get(entry.id);
      if (!node) { reveal(entry); continue; }
      if (entry.model !== node.internals.userNode) {
        entry.model = node.internals.userNode;
        if (entry.suspended) measurements.add(entry);
        reveal(entry); entry.lease = frameNumber + 2;
      }
      if (entry.lease > frameNumber) {
        reveal(entry); needsFrame = true; continue;
      }
      const width = node.measured.width, height = node.measured.height;
      const left = node.internals.positionAbsolute.x * zoom + x;
      const top = node.internals.positionAbsolute.y * zoom + y;
      // 工程可能带持久化尺寸；仍须等官方首次测出端口后才能暂停 DOM 布局。
      const outside = node.internals.handleBounds && width && height && (left + width * zoom < -512 || left > state.width + 512
        || top + height * zoom < -512 || top > state.height + 512);
      const keep = keyboardNavigation || node.selected || node.dragging || parents.has(node.id) || entry.expanded || entry.element.contains(focused);
      if (!outside || keep) { reveal(entry); continue; }
      if (!entry.suspended) {
        entry.element.setAttribute(ATTRIBUTE, 'true');
        entry.header?.setAttribute(ATTRIBUTE, 'true');
        entry.suspended = true;
      }
    }
    if (needsFrame || measurements.size) schedule();
  }

  const unsubscribe = source.subscribe(() => {
    const transform = source.getState().transform;
    // 视口同步提交期间立即恢复即将出现的内容，不额外落后一帧。
    if (transform !== previousTransform) { previousTransform = transform; reconcile(); }
    else schedule();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' && !(event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey))) return;
    keyboardNavigation = true;
    entries.forEach(reveal);
  };
  const onPointerDown = () => { keyboardNavigation = false; schedule(); };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  schedule();
  return () => {
    disposed = true; unsubscribe();
    if (frame !== null) cancelAnimationFrame(frame);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    clearRoot();
  };
}
