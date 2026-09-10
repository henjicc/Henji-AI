interface FlowPath {
  path: Path2D;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// 30Hz 表达流动；视口变化立即重画，避免拖动时错位。
const FRAME_INTERVAL = 1000 / 30;
const DASH_PERIOD = 32;
const FLOW_SPEED = 60;

export class EdgeFlowCanvas {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null;
  private readonly paths = new Map<Element, FlowPath>();
  private readonly resize: ResizeObserver;
  private readonly viewportObserver: MutationObserver;
  private readonly themeObserver: MutationObserver;
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private matrix = new DOMMatrix();
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private color = '';
  private frame = 0;
  private lastDraw = -Infinity;
  private visibleCount = 0;
  private drawCount = 0;
  private offset = 0;

  constructor(private readonly flow: HTMLElement, pane: HTMLElement, private readonly viewport: HTMLElement) {
    this.canvas.className = 'canvas-edge-flow-layer pointer-events-none absolute inset-0 h-full w-full text-accent';
    this.canvas.setAttribute('aria-hidden', 'true');
    // 位于节点所在 viewport 之前，节点和端口继续遮挡连线；不改变原视口的合成/测量。
    pane.prepend(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.resize = new ResizeObserver(() => this.resizeLayer());
    this.resize.observe(flow);
    this.viewportObserver = new MutationObserver(() => {
      this.matrix = new DOMMatrix(this.viewport.style.transform);
      this.draw(performance.now());
    });
    this.viewportObserver.observe(viewport, { attributes: true, attributeFilter: ['style'] });
    this.themeObserver = new MutationObserver(this.refreshTheme);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    this.motion.addEventListener('change', this.refresh);
    document.addEventListener('visibilitychange', this.refresh);
    this.matrix = new DOMMatrix(viewport.style.transform);
    this.color = getComputedStyle(this.canvas).color;
    this.resizeLayer();
  }

  get size() { return this.paths.size; }

  add(key: Element, path: string): void {
    // SVG 只作为脱离 DOM 的几何采样器，播放时不读取路径或节点几何。
    const sampler = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sampler.setAttribute('d', path);
    const length = sampler.getTotalLength();
    if (!Number.isFinite(length) || length < 1) return;
    const steps = Math.min(96, Math.max(16, Math.ceil(length / 8)));
    const points = Array.from({ length: steps + 1 }, (_, index) => sampler.getPointAtLength(length * index / steps));
    this.paths.set(key, {
      path: new Path2D(path),
      left: Math.min(...points.map((point) => point.x)) - 4,
      top: Math.min(...points.map((point) => point.y)) - 4,
      right: Math.max(...points.map((point) => point.x)) + 4,
      bottom: Math.max(...points.map((point) => point.y)) + 4,
    });
    this.lastDraw = -Infinity;
    this.schedule();
  }

  remove(key: Element): void {
    this.paths.delete(key);
    this.lastDraw = -Infinity;
    this.schedule();
  }

  private resizeLayer(): void {
    this.width = this.flow.clientWidth;
    this.height = this.flow.clientHeight;
    // 限制透明画布的像素成本，不影响节点文字清晰度。
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.ceil(this.width * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.ceil(this.height * this.pixelRatio));
    this.draw(performance.now());
  }

  private refreshTheme = (): void => {
    this.color = getComputedStyle(this.canvas).color;
    this.refresh();
  };

  private refresh = (): void => { this.draw(performance.now()); };

  private schedule(): void {
    if (!this.frame && this.context && !document.hidden) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = 0;
    if (now - this.lastDraw >= FRAME_INTERVAL) this.draw(now);
    else if (this.visibleCount > 0 && !this.motion.matches) this.schedule();
  };

  private draw(now: number): void {
    const ctx = this.context;
    if (!ctx) return;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    this.lastDraw = now;
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.visibleCount = 0;
    if (document.hidden || !this.width || !this.height) return;
    const { a: zoom, e: x, f: y } = this.matrix;
    if (!(zoom > 0)) return;
    const left = -x / zoom;
    const top = -y / zoom;
    const right = (this.width - x) / zoom;
    const bottom = (this.height - y) / zoom;
    const ratio = this.pixelRatio;
    ctx.setTransform(zoom * ratio, 0, 0, zoom * ratio, x * ratio, y * ratio);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.setLineDash([12, 20]);
    this.offset = this.motion.matches ? 0 : -(now * FLOW_SPEED / 1000) % DASH_PERIOD;
    ctx.lineDashOffset = this.offset;
    for (const entry of this.paths.values()) {
      if (entry.right < left || entry.left > right || entry.bottom < top || entry.top > bottom) continue;
      ctx.stroke(entry.path);
      this.visibleCount += 1;
    }
    this.drawCount += 1;
    if (this.visibleCount > 0 && !this.motion.matches) this.schedule();
  }

  diagnostics() {
    return { pathCount: this.size, visibleCount: this.visibleCount, drawCount: this.drawCount, offset: this.offset, scheduled: !!this.frame, matrix: { zoom: this.matrix.a, x: this.matrix.e, y: this.matrix.f } };
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.viewportObserver.disconnect();
    this.themeObserver.disconnect();
    this.motion.removeEventListener('change', this.refresh);
    document.removeEventListener('visibilitychange', this.refresh);
    this.canvas.remove();
  }
}
