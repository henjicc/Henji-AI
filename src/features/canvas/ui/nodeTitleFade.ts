// 短标题完全处于渐变的不透明区域时，无需为它保留一层遮罩。
// 用真实排版测量，保留一整行高的字形余量；长标题、不可测量标题仍使用原遮罩。
export const NODE_TITLE_MASK_PROPERTY = '--canvas-node-title-mask';

type TitleObservers = {
  observe: (element: HTMLElement) => () => void;
};

const observersByDocument = new WeakMap<Document, TitleObservers>();

function fitsOpaqueArea(element: HTMLElement): boolean | undefined {
  const bounds = element.getBoundingClientRect();
  // 屏外暂停时不改动已知结果，避免反复拆建遮罩。标题改名时由组件先清理旧结果，
  // 返回屏幕后的 ResizeObserver 会在绘制前用新尺寸重新判断。
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  if (element.childElementCount > 0) return false;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const text = range.getBoundingClientRect();
  return text.width > 0 && text.height > 0 && text.left >= bounds.left
    && text.right + text.height <= bounds.left + bounds.width * 0.82;
}

function createTitleObservers(ownerDocument: Document): TitleObservers {
  const elements = new Set<HTMLElement>();
  const update = (targets: Iterable<HTMLElement>) => {
    // 先读完本批尺寸，再写绘制属性，避免逐节点强制布局。
    const changes = Array.from(targets)
      .filter(element => elements.has(element))
      .map(element => ({ element, fits: fitsOpaqueArea(element) }));
    for (const { element, fits } of changes) {
      if (fits === undefined) continue;
      const current = element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY);
      if (fits && current !== 'none') element.style.setProperty(NODE_TITLE_MASK_PROPERTY, 'none');
      else if (!fits && current) element.style.removeProperty(NODE_TITLE_MASK_PROPERTY);
    }
  };
  const resize = new ResizeObserver(entries => update(entries.map(entry => entry.target as HTMLElement)));
  const refreshAll = () => update(elements);
  // 字号/字体主题与异步字体加载可能改变文字宽度，而不改变标题的分配宽度。
  const theme = new MutationObserver(refreshAll);
  theme.observe(ownerDocument.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  ownerDocument.fonts?.addEventListener('loadingdone', refreshAll);

  return {
    observe(element) {
      elements.add(element);
      resize.observe(element);
      return () => {
        elements.delete(element);
        resize.unobserve(element);
        element.style.removeProperty(NODE_TITLE_MASK_PROPERTY);
        if (elements.size === 0) {
          resize.disconnect();
          theme.disconnect();
          ownerDocument.fonts?.removeEventListener('loadingdone', refreshAll);
          observersByDocument.delete(ownerDocument);
        }
      };
    },
  };
}

export function observeNodeTitleFade(element: HTMLElement): (() => void) | undefined {
  if (typeof ResizeObserver === 'undefined') return undefined;
  const ownerDocument = element.ownerDocument;
  let observers = observersByDocument.get(ownerDocument);
  if (!observers) {
    observers = createTitleObservers(ownerDocument);
    observersByDocument.set(ownerDocument, observers);
  }
  return observers.observe(element);
}
