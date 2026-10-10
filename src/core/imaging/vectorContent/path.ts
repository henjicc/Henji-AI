import { rasterizeRegionContours, combineRegionCoverage, throwIfRegionAborted, assertRegionRect, type Coverage, type RegionPoint, type RegionRect, type RegionSource } from '../regions';
import type { VectorPath, VectorPathCommand, VectorPathOperand } from './contracts';

export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(cx1: number, cy1: number, cx2: number, cy2: number, x: number, y: number): void;
  closePath(): void;
}
/** The sole command interpreter; Canvas, SVG adapters and font outlines use this contract. */
export function traceVectorPath(sink: PathSink, path: VectorPath): void {
  for (const command of path.commands) {
    switch (command.kind) {
      case 'move': sink.moveTo(command.x, command.y); break;
      case 'line': sink.lineTo(command.x, command.y); break;
      case 'quadratic': sink.quadraticCurveTo(command.cx, command.cy, command.x, command.y); break;
      case 'cubic': sink.bezierCurveTo(command.cx1, command.cy1, command.cx2, command.cy2, command.x, command.y); break;
      case 'close': sink.closePath(); break;
    }
  }
}
export function rectanglePath(x: number, y: number, width: number, height: number): VectorPath {
  return { fillRule: 'nonzero', commands: [{ kind: 'move', x, y }, { kind: 'line', x: x + width, y }, { kind: 'line', x: x + width, y: y + height }, { kind: 'line', x, y: y + height }, { kind: 'close' }] };
}
export function ellipsePath(x: number, y: number, width: number, height: number): VectorPath {
  const k = 4 / 3 * (Math.sqrt(2) - 1), rx = width / 2, ry = height / 2, cx = x + rx, cy = y + ry;
  return { fillRule: 'nonzero', commands: [{ kind: 'move', x: cx, y },
    { kind: 'cubic', cx1: cx + k * rx, cy1: y, cx2: x + width, cy2: cy - k * ry, x: x + width, y: cy },
    { kind: 'cubic', cx1: x + width, cy1: cy + k * ry, cx2: cx + k * rx, cy2: y + height, x: cx, y: y + height },
    { kind: 'cubic', cx1: cx - k * rx, cy1: y + height, cx2: x, cy2: cy + k * ry, x, y: cy },
    { kind: 'cubic', cx1: x, cy1: cy - k * ry, cx2: cx - k * rx, cy2: y, x: cx, y }, { kind: 'close' }] };
}
export function polylinePath(points: readonly RegionPoint[], closed = false): VectorPath {
  return { fillRule: 'nonzero', commands: points.map((point, index) => ({ kind: index ? 'line' : 'move', ...point } as VectorPathCommand)).concat(closed ? [{ kind: 'close' }] : []) };
}
export function arrowPath(start: RegionPoint, end: RegionPoint, width: number, control?: RegionPoint): VectorPath {
  const angle = Math.atan2(end.y - (control ?? start).y, end.x - (control ?? start).x), head = Math.min(Math.hypot(end.x - start.x, end.y - start.y), width * 4);
  const point = (a: number): RegionPoint => ({ x: end.x - Math.cos(a) * head, y: end.y - Math.sin(a) * head });
  return { fillRule: 'nonzero', commands: [{ kind: 'move', ...start }, control ? { kind: 'quadratic', cx: control.x, cy: control.y, ...end } : { kind: 'line', ...end }, { kind: 'move', ...point(angle - Math.PI / 6) }, { kind: 'line', ...end }, { kind: 'line', ...point(angle + Math.PI / 6) }] };
}

/** Adaptive flattening is a geometry adapter; coverage/boolean math remains in regions. */
export function flattenVectorPath(path: VectorPath, tolerance = .125, signal?: AbortSignal): RegionPoint[][] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('路径精度必须为正数。');
  const result: RegionPoint[][] = [];
  let contour: RegionPoint[] = [];
  let point = { x: 0, y: 0 };
  const midpoint = (a: RegionPoint, b: RegionPoint): RegionPoint => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });
  const distance = (p: RegionPoint, a: RegionPoint, b: RegionPoint): number => {
    const dx = b.x - a.x, dy = b.y - a.y;
    return dx || dy ? Math.abs((dy / Math.hypot(dx, dy)) * (p.x - a.x) - (dx / Math.hypot(dx, dy)) * (p.y - a.y)) : Math.hypot(p.x - a.x, p.y - a.y);
  };
  const curve = (a: RegionPoint, b: RegionPoint, c: RegionPoint, d: RegionPoint): void => {
    const pending = [[a, b, c, d]];
    while (pending.length) {
      throwIfRegionAborted(signal);
      const [p0, p1, p2, p3] = pending.pop()!;
      if (Math.max(distance(p1, p0, p3), distance(p2, p0, p3)) <= tolerance) { contour.push(p3); continue; }
      const p01 = midpoint(p0, p1), p12 = midpoint(p1, p2), p23 = midpoint(p2, p3), p012 = midpoint(p01, p12), p123 = midpoint(p12, p23), middle = midpoint(p012, p123);
      pending.push([middle, p123, p23, p3], [p0, p01, p012, middle]);
    }
  };
  for (const command of path.commands) {
    throwIfRegionAborted(signal);
    if (command.kind === 'move') { contour = [{ x: command.x, y: command.y }]; result.push(contour); point = contour[0]; }
    else if (command.kind === 'line') { point = { x: command.x, y: command.y }; contour.push(point); }
    else if (command.kind === 'quadratic') { const end = { x: command.x, y: command.y }; curve(point, { x: point.x + 2 / 3 * (command.cx - point.x), y: point.y + 2 / 3 * (command.cy - point.y) }, { x: end.x + 2 / 3 * (command.cx - end.x), y: end.y + 2 / 3 * (command.cy - end.y) }, end); point = end; }
    else if (command.kind === 'cubic') { const end = { x: command.x, y: command.y }; curve(point, { x: command.cx1, y: command.cy1 }, { x: command.cx2, y: command.cy2 }, end); point = end; }
    else if (contour.length) point = contour[0];
  }
  return result;
}
export function createVectorRegionSource(operands: readonly VectorPathOperand[]): RegionSource {
  return { defaultValue: 0, read: (region: RegionRect, context): Coverage => {
    assertRegionRect(region); throwIfRegionAborted(context.signal);
    const output = new Float32Array(region.width * region.height);
    for (const operand of operands) {
      const coverage = rasterizeRegionContours(region.width,region.height,region.x,region.y,flattenVectorPath(operand.path,context.quality==='final'?.0625:.25,context.signal),operand.path.fillRule,context.signal);
      for (let index = 0; index < output.length; index++) output[index] = combineRegionCoverage(output[index], coverage[index], operand.operation);
    }
    return { ...region, data: output };
  } };
}

/** Coordinates are sampled at the host's current mip; no full-frame mask allocation. */
export function rasterizeVectorCoverage(operands:readonly VectorPathOperand[],region:RegionRect,scaleX=1,scaleY=scaleX,signal?:AbortSignal):Float32Array {
  const scaled=operands.map(operand=>({...operand,path:{...operand.path,commands:operand.path.commands.map(command=>Object.fromEntries(Object.entries(command).map(([key,value])=>[key,typeof value==='number'?value*(key.startsWith('x')||key.startsWith('cx')?scaleX:scaleY):value])) as unknown as VectorPathCommand)}}));
  const coverage=createVectorRegionSource(scaled).read(region,{sourceVersion:'vector-mask',time:{kind:'static'},referenceGrid:{width:region.width,height:region.height},quality:'final',signal});
  if(coverage instanceof Promise) throw new Error('静态路径覆盖不应异步');
  return coverage.data;
}

export function transformVectorPath(path:VectorPath,matrix:readonly [number,number,number,number,number,number]):VectorPath {
  const point=(x:number,y:number)=>({x:matrix[0]*x+matrix[2]*y+matrix[4],y:matrix[1]*x+matrix[3]*y+matrix[5]});
  return {...path,commands:path.commands.map(command=>{
    if(command.kind==='close') return {...command};
    const end=point(command.x,command.y);
    if(command.kind==='quadratic'){const control=point(command.cx,command.cy);return {...command,...end,cx:control.x,cy:control.y};}
    if(command.kind==='cubic'){const c1=point(command.cx1,command.cy1),c2=point(command.cx2,command.cy2);return {...command,...end,cx1:c1.x,cy1:c1.y,cx2:c2.x,cy2:c2.y};}
    return {...command,...end};
  })};
}
