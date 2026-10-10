import { REGION_AA_SAMPLES_PER_AXIS, type RegionGeometry, type RegionPoint } from './contracts';
import { regionGeometryBounds } from './geometry';
import { throwIfRegionAborted } from './coverage';

function clippedLocalRange(
  start: number,
  end: number,
  origin: number,
  size: number,
): readonly [number, number] {
  return [
    Math.max(0, Math.min(size, Math.floor(start - origin))),
    Math.max(0, Math.min(size, Math.ceil(end - origin))),
  ];
}

function rasterizeRectangleCoverage(
  output: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: Extract<RegionGeometry, { type: 'rectangle' }>,
): void {
  const bounds = regionGeometryBounds(shape);
  const [startX, endX] = clippedLocalRange(bounds.left, bounds.right, originX, width);
  const [startY, endY] = clippedLocalRange(bounds.top, bounds.bottom, originY, height);
  for (let y = startY; y < endY; y += 1) {
    const documentY = originY + y;
    const vertical = Math.max(
      0,
      Math.min(documentY + 1, bounds.bottom) - Math.max(documentY, bounds.top),
    );
    for (let x = startX; x < endX; x += 1) {
      const documentX = originX + x;
      const horizontal = Math.max(
        0,
        Math.min(documentX + 1, bounds.right) - Math.max(documentX, bounds.left),
      );
      output[y * width + x] = Math.min(1, horizontal * vertical);
    }
  }
}

function rasterizeEllipseCoverage(
  output: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: Extract<RegionGeometry, { type: 'ellipse' }>,
  signal?: AbortSignal,
): void {
  const bounds = regionGeometryBounds(shape);
  const radiusX = (bounds.right - bounds.left) / 2;
  const radiusY = (bounds.bottom - bounds.top) / 2;
  if (radiusX <= 0 || radiusY <= 0) return;
  const centerX = bounds.left + radiusX;
  const centerY = bounds.top + radiusY;
  const samples = REGION_AA_SAMPLES_PER_AXIS;
  const [startX, endX] = clippedLocalRange(bounds.left, bounds.right, originX, width);
  const [startY, endY] = clippedLocalRange(bounds.top, bounds.bottom, originY, height);
  for (let y = startY; y < endY; y += 1) {
    if ((y & 31) === 0) throwIfRegionAborted(signal);
    const documentY = originY + y;
    const nearY = centerY < documentY
      ? documentY - centerY
      : centerY > documentY + 1 ? centerY - documentY - 1 : 0;
    const farY = Math.max(Math.abs(documentY - centerY), Math.abs(documentY + 1 - centerY));
    for (let x = startX; x < endX; x += 1) {
      const documentX = originX + x;
      const nearX = centerX < documentX
        ? documentX - centerX
        : centerX > documentX + 1 ? centerX - documentX - 1 : 0;
      const nearest = (nearX / radiusX) ** 2 + (nearY / radiusY) ** 2;
      if (nearest >= 1) continue;
      const farX = Math.max(Math.abs(documentX - centerX), Math.abs(documentX + 1 - centerX));
      const farthest = (farX / radiusX) ** 2 + (farY / radiusY) ** 2;
      if (farthest <= 1) {
        output[y * width + x] = 1;
        continue;
      }
      let inside = 0;
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        const dy = (documentY + (sampleY + 0.5) / samples - centerY) / radiusY;
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const dx = (documentX + (sampleX + 0.5) / samples - centerX) / radiusX;
          if (dx * dx + dy * dy <= 1) inside += 1;
        }
      }
      output[y * width + x] = inside / (samples * samples);
    }
  }
}

function addLassoSampleInterval(
  partialCounts: Uint8Array,
  fullPixelDifference: Int16Array,
  originX: number,
  left: number,
  right: number,
): void {
  const samples = REGION_AA_SAMPLES_PER_AXIS;
  const globalStart = originX * samples;
  const globalEnd = globalStart + partialCounts.length * samples;
  let start = Math.max(globalStart, Math.ceil(left * samples - 0.5));
  const end = Math.min(globalEnd, Math.ceil(right * samples - 0.5));
  if (end <= start) return;

  while (start < end && start % samples !== 0) {
    partialCounts[Math.floor((start - globalStart) / samples)] += 1;
    start += 1;
  }
  const fullEnd = end - ((end - globalStart) % samples);
  if (fullEnd > start) {
    const firstPixel = (start - globalStart) / samples;
    const afterPixel = (fullEnd - globalStart) / samples;
    fullPixelDifference[firstPixel] += samples;
    fullPixelDifference[afterPixel] -= samples;
    start = fullEnd;
  }
  while (start < end) {
    partialCounts[Math.floor((start - globalStart) / samples)] += 1;
    start += 1;
  }
}

function rasterizeLassoCoverage(
  output: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: Extract<RegionGeometry, { type: 'lasso' }>,
  signal?: AbortSignal,
  contours: readonly (readonly RegionPoint[])[] = [shape.points],
  fillRule: 'nonzero' | 'evenodd' = 'evenodd',
): void {
  const bounds = regionGeometryBounds(shape);
  const [startY, endY] = clippedLocalRange(bounds.top, bounds.bottom, originY, height);
  const samples = REGION_AA_SAMPLES_PER_AXIS;
  for (let y = startY; y < endY; y += 1) {
    if ((y & 31) === 0) throwIfRegionAborted(signal);
    const partialCounts = new Uint8Array(width);
    const fullPixelDifference = new Int16Array(width + 1);
    for (let sampleY = 0; sampleY < samples; sampleY += 1) {
      const documentY = originY + y + (sampleY + 0.5) / samples;
      const intersections: { x: number; winding: number }[] = [];
      for(const points of contours) {
        let previous=points[points.length-1];
        for(const current of points){
          if((current.y>documentY)!==(previous.y>documentY)) intersections.push({x:current.x+(documentY-current.y)*(previous.x-current.x)/(previous.y-current.y),winding:current.y>previous.y?1:-1});
          previous=current;
        }
      }
      intersections.sort((left,right)=>left.x-right.x);
      let winding=0;
      for(let index=0;index+1<intersections.length;index++){
        winding += fillRule==='evenodd' ? 1 : intersections[index].winding;
        if(fillRule==='evenodd' ? winding%2!==0 : winding!==0) addLassoSampleInterval(partialCounts,fullPixelDifference,originX,intersections[index].x,intersections[index+1].x);
      }
    }
    let fullSamples = 0;
    for (let x = 0; x < width; x += 1) {
      fullSamples += fullPixelDifference[x];
      output[y * width + x] = (fullSamples + partialCounts[x]) / (samples * samples);
    }
  }
}

export function rasterizeRegionGeometry(
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: RegionGeometry,
  signal?: AbortSignal,
): Float32Array {
  const output = new Float32Array(width * height);
  if (shape.type === 'rectangle') {
    rasterizeRectangleCoverage(output, width, height, originX, originY, shape);
  } else if (shape.type === 'ellipse') {
    rasterizeEllipseCoverage(output, width, height, originX, originY, shape, signal);
  } else {
    rasterizeLassoCoverage(output, width, height, originX, originY, shape, signal);
  }
  return output;
}


/** Compound contours share the exact same AA scanline kernel as selection lassos. */
export function rasterizeRegionContours(width:number,height:number,originX:number,originY:number,contours:readonly (readonly RegionPoint[])[],fillRule:'nonzero'|'evenodd',signal?:AbortSignal):Float32Array {
  const output=new Float32Array(width*height);
  const valid=contours.filter(points=>points.length>=3);
  if(valid.length) rasterizeLassoCoverage(output,width,height,originX,originY,{type:'lasso',points:valid.flat()},signal,valid,fillRule);
  return output;
}
