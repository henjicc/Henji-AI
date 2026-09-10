interface FlowPlayback {
  animation: Animation;
  visible: boolean;
}

// 所有正在生成的连线共用观察器；不订阅逐帧视口，不轮询可见性。
const flows = new Map<Element, FlowPlayback>();
let observer: IntersectionObserver | undefined;
let reducedMotion: MediaQueryList | undefined;

function updatePlayback(flow: FlowPlayback): void {
  const playing = flow.visible && !document.hidden && !reducedMotion?.matches;
  if (playing && flow.animation.playState !== 'running') flow.animation.play();
  if (!playing && flow.animation.playState !== 'paused') flow.animation.pause();
}

function updateAll(): void {
  flows.forEach(updatePlayback);
}

export function observeEdgeFlow(element: Element, animation: Animation): () => void {
  if (flows.size === 0) {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.addEventListener('change', updateAll);
    document.addEventListener('visibilitychange', updateAll);
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const flow = flows.get(entry.target);
        if (!flow) continue;
        flow.visible = entry.isIntersecting;
        updatePlayback(flow);
      }
    }, { rootMargin: '96px' });
  }
  const flow = { animation, visible: false };
  flows.set(element, flow);
  updatePlayback(flow);
  observer?.observe(element);

  return () => {
    observer?.unobserve(element);
    flows.delete(element);
    animation.cancel();
    if (flows.size !== 0) return;
    observer?.disconnect();
    observer = undefined;
    reducedMotion?.removeEventListener('change', updateAll);
    reducedMotion = undefined;
    document.removeEventListener('visibilitychange', updateAll);
  };
}
