import type { RegistrationFrame, RegistrationOptions } from "./types";
import { normalizedLuminance } from "./normalized-luminance";

export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
  validMask?: Uint8Array;
}

interface Keypoint {
  x: number;
  y: number;
  score: number;
  descriptor: Uint32Array;
}

export interface PointMatch {
  movingX: number;
  movingY: number;
  referenceX: number;
  referenceY: number;
  distance?: number;
}

const PYRAMID_SCALES = [1, 0.82, 0.67];
const DESCRIPTOR_WORDS = 4;
const DESCRIPTOR_BITS = DESCRIPTOR_WORDS * 32;
const PATCH_RADIUS = 11;

export function frameToGray(frame: RegistrationFrame): GrayImage {
  const count = frame.width * frame.height;
  if (frame.width < 8 || frame.height < 8 || frame.data.length < count) {
    throw new Error("Invalid registration frame");
  }
  const gray = normalizedLuminance(frame);
  return {
    width: frame.width,
    height: frame.height,
    data: gray,
    validMask: frame.validMask,
  };
}

export function resizeGray(source: GrayImage, scale: number): GrayImage {
  if (scale === 1) return source;
  const width = Math.max(16, Math.round(source.width * scale));
  const height = Math.max(16, Math.round(source.height * scale));
  const data = new Float32Array(width * height);
  const validMask = source.validMask
    ? new Uint8Array(width * height)
    : undefined;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(source.height - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, (x + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sx - x0;
      const top =
        source.data[y0 * source.width + x0] * (1 - fx) +
        source.data[y0 * source.width + x1] * fx;
      const bottom =
        source.data[y1 * source.width + x0] * (1 - fx) +
        source.data[y1 * source.width + x1] * fx;
      data[y * width + x] = top * (1 - fy) + bottom * fy;
      if (validMask && source.validMask) {
        const maskX = Math.min(source.width - 1, Math.max(0, Math.round(sx)));
        const maskY = Math.min(source.height - 1, Math.max(0, Math.round(sy)));
        validMask[y * width + x] =
          source.validMask[maskY * source.width + maskX];
      }
    }
  }
  return { width, height, data, validMask };
}

function isPatchValid(image: GrayImage, x: number, y: number): boolean {
  if (!image.validMask) return true;
  const radius = PATCH_RADIUS + 1;
  const points = [
    [x, y],
    [x - radius, y - radius],
    [x + radius, y - radius],
    [x - radius, y + radius],
    [x + radius, y + radius],
  ];
  return points.every(([px, py]) => {
    const ix = Math.round(px);
    const iy = Math.round(py);
    return (
      ix >= 0 &&
      iy >= 0 &&
      ix < image.width &&
      iy < image.height &&
      image.validMask![iy * image.width + ix] !== 0
    );
  });
}

function sample(image: GrayImage, x: number, y: number): number {
  const ix = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  return image.data[iy * image.width + ix];
}

export function bilinearSample(image: GrayImage, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top =
    image.data[y0 * image.width + x0] * (1 - fx) +
    image.data[y0 * image.width + x1] * fx;
  const bottom =
    image.data[y1 * image.width + x0] * (1 - fx) +
    image.data[y1 * image.width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function descriptorPairs(): Int8Array {
  const pairs = new Int8Array(DESCRIPTOR_BITS * 4);
  let state = 0x6d2b79f5;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), state | 1) + 0x9e3779b9) | 0;
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < DESCRIPTOR_BITS; i++) {
    for (let p = 0; p < 2; p++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * PATCH_RADIUS;
      pairs[i * 4 + p * 2] = Math.round(Math.cos(angle) * radius);
      pairs[i * 4 + p * 2 + 1] = Math.round(Math.sin(angle) * radius);
    }
  }
  return pairs;
}

const BRIEF_PAIRS = descriptorPairs();

function describe(image: GrayImage, x: number, y: number): Uint32Array {
  let mx = 0;
  let my = 0;
  for (let oy = -6; oy <= 6; oy += 2) {
    for (let ox = -6; ox <= 6; ox += 2) {
      const value = sample(image, x + ox, y + oy) + 3;
      mx += ox * value;
      my += oy * value;
    }
  }
  const angle = Math.atan2(my, mx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out = new Uint32Array(DESCRIPTOR_WORDS);
  for (let bit = 0; bit < DESCRIPTOR_BITS; bit++) {
    const offset = bit * 4;
    const x1 = BRIEF_PAIRS[offset];
    const y1 = BRIEF_PAIRS[offset + 1];
    const x2 = BRIEF_PAIRS[offset + 2];
    const y2 = BRIEF_PAIRS[offset + 3];
    const p1 = sample(image, x + x1 * cos - y1 * sin, y + x1 * sin + y1 * cos);
    const p2 = sample(image, x + x2 * cos - y2 * sin, y + x2 * sin + y2 * cos);
    if (p1 < p2) out[bit >>> 5] |= 1 << (bit & 31);
  }
  return out;
}

function detectLevel(
  image: GrayImage,
  originalScale: number,
  options: RegistrationOptions,
  limit: number,
): Keypoint[] {
  const margin = PATCH_RADIUS + 3;
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  const response = new Float32Array(image.width * image.height);
  let maxResponse = 0;
  for (let y = margin; y < image.height - margin; y++) {
    for (let x = margin; x < image.width - margin; x++) {
      if (!isPatchValid(image, x, y)) continue;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const row = (y + oy) * image.width;
        for (let ox = -1; ox <= 1; ox++) {
          const index = row + x + ox;
          const gx = image.data[index + 1] - image.data[index - 1];
          const gy =
            image.data[index + image.width] - image.data[index - image.width];
          sxx += gx * gx;
          syy += gy * gy;
          sxy += gx * gy;
        }
      }
      const determinant = sxx * syy - sxy * sxy;
      const trace = sxx + syy;
      const score = determinant - 0.045 * trace * trace;
      response[y * image.width + x] = score;
      if (score > maxResponse) maxResponse = score;
    }
  }
  const threshold = maxResponse * 0.012;
  for (let y = margin; y < image.height - margin; y += 2) {
    for (let x = margin; x < image.width - margin; x += 2) {
      const score = response[y * image.width + x];
      if (score <= threshold) continue;
      let localMax = true;
      for (let oy = -2; oy <= 2 && localMax; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          if (response[(y + oy) * image.width + x + ox] > score) {
            localMax = false;
            break;
          }
        }
      }
      if (localMax) candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const perCell = Math.max(
    1,
    Math.ceil(limit / (options.gridColumns * options.gridRows)),
  );
  const counts = new Uint16Array(options.gridColumns * options.gridRows);
  const selected: Keypoint[] = [];
  for (const candidate of candidates) {
    const column = Math.min(
      options.gridColumns - 1,
      Math.floor((candidate.x / image.width) * options.gridColumns),
    );
    const row = Math.min(
      options.gridRows - 1,
      Math.floor((candidate.y / image.height) * options.gridRows),
    );
    const cell = row * options.gridColumns + column;
    if (counts[cell] >= perCell) continue;
    counts[cell]++;
    selected.push({
      x: candidate.x / originalScale,
      y: candidate.y / originalScale,
      score: candidate.score,
      descriptor: describe(image, candidate.x, candidate.y),
    });
    if (selected.length >= limit) break;
  }
  return selected;
}

export function detectKeypoints(
  image: GrayImage,
  options: RegistrationOptions,
): Keypoint[] {
  const perLevel = Math.ceil(options.maxKeypoints / PYRAMID_SCALES.length);
  const points: Keypoint[] = [];
  for (const scale of PYRAMID_SCALES) {
    points.push(
      ...detectLevel(resizeGray(image, scale), scale, options, perLevel),
    );
  }
  return points;
}

function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hamming(a: Uint32Array, b: Uint32Array): number {
  let distance = 0;
  for (let i = 0; i < DESCRIPTOR_WORDS; i++) {
    distance += popcount((a[i] ^ b[i]) >>> 0);
  }
  return distance;
}

function nearest(
  source: Keypoint[],
  target: Keypoint[],
  ratio: number,
): Array<{ index: number; distance: number } | null> {
  return source.map((point) => {
    let best = -1;
    let bestDistance = Infinity;
    let secondDistance = Infinity;
    for (let i = 0; i < target.length; i++) {
      const distance = hamming(point.descriptor, target[i].descriptor);
      if (distance < bestDistance) {
        secondDistance = bestDistance;
        bestDistance = distance;
        best = i;
      } else if (distance < secondDistance) {
        secondDistance = distance;
      }
    }
    if (
      best < 0 ||
      bestDistance > 58 ||
      bestDistance >= secondDistance * ratio
    ) {
      return null;
    }
    return { index: best, distance: bestDistance };
  });
}

export function matchKeypoints(
  reference: Keypoint[],
  moving: Keypoint[],
  ratio: number,
): PointMatch[] {
  const forward = nearest(moving, reference, ratio);
  const candidates: Array<{
    movingIndex: number;
    referenceIndex: number;
    distance: number;
  }> = [];
  forward.forEach((candidate, movingIndex) => {
    if (candidate) {
      candidates.push({
        movingIndex,
        referenceIndex: candidate.index,
        distance: candidate.distance,
      });
    }
  });
  candidates.sort((a, b) => a.distance - b.distance);
  const usedReference = new Set<number>();
  const matches: PointMatch[] = [];
  for (const candidate of candidates) {
    if (usedReference.has(candidate.referenceIndex)) continue;
    usedReference.add(candidate.referenceIndex);
    const from = moving[candidate.movingIndex];
    const to = reference[candidate.referenceIndex];
    matches.push({
      movingX: from.x,
      movingY: from.y,
      referenceX: to.x,
      referenceY: to.y,
      distance: candidate.distance,
    });
  }
  return matches;
}
