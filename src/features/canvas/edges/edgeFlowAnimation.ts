import { observeEdgeFlow } from './edgeFlowPlayback';

// 持续运行指示按路程设定周期；不是普通界面过渡的时长档位。
const FLOW_SPEED = 160;
const PULSE_RADIUS = 4;

export function sampleEdgeFlow(path: Pick<SVGPathElement, 'getTotalLength' | 'getPointAtLength'>) {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length < 1) return null;
  const steps = Math.min(96, Math.max(16, Math.ceil(length / 8)));
  const points = Array.from({ length: steps + 1 }, (_, index) => path.getPointAtLength(length * index / steps));
  const left = Math.min(...points.map((point) => point.x)) - PULSE_RADIUS;
  const top = Math.min(...points.map((point) => point.y)) - PULSE_RADIUS;
  return {
    left, top,
    width: Math.max(...points.map((point) => point.x)) - left + PULSE_RADIUS,
    height: Math.max(...points.map((point) => point.y)) - top + PULSE_RADIUS,
    duration: Math.max(1200, Math.min(6000, length / FLOW_SPEED * 1000)),
    keyframes: points.map((point, index) => ({
      offset: index / steps,
      transform: `translate(${point.x - left - PULSE_RADIUS}px, ${point.y - top - PULSE_RADIUS}px)`,
      opacity: index === 0 || index === steps ? 0 : 1,
    })),
  };
}

/** 光点唯一播放入口，真实 Electron 基准也复用此实现，不维护另一份动画。 */
export function mountEdgeFlowPulse(bounds: HTMLDivElement, path: string, initialPhase = 0): () => number {
  // 脱离 DOM 的路径只在端点变化时采样；播放/平移期间不读几何、不执行 RAF。
  const sampler = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  sampler.setAttribute('d', path);
  const geometry = sampleEdgeFlow(sampler);
  if (!geometry) return () => initialPhase;
  bounds.className = 'pointer-events-none absolute left-0 top-0';
  Object.assign(bounds.style, {
    transform: `translate(${geometry.left}px, ${geometry.top}px)`,
    width: `${geometry.width}px`,
    height: `${geometry.height}px`,
  });
  const pulse = document.createElement('div');
  pulse.className = 'canvas-edge-flow-pulse pointer-events-none absolute left-0 top-0 h-2 w-2 rounded-full bg-text-dark';
  bounds.appendChild(pulse);
  const animation = pulse.animate(geometry.keyframes, {
    duration: geometry.duration,
    iterations: Infinity,
    easing: 'linear',
  });
  animation.currentTime = initialPhase * geometry.duration;
  const release = observeEdgeFlow(bounds, animation);
  return () => {
    const current = animation.currentTime;
    const phase = typeof current === 'number' ? (current % geometry.duration) / geometry.duration : initialPhase;
    release();
    pulse.remove();
    return phase;
  };
}
