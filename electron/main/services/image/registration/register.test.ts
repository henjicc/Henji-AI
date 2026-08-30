import { describe, expect, it } from "vitest";
import { estimateSimilarityRansac, refitAnisotropic } from "./geometry";
import type { PointMatch } from "./features";
import { registerImages } from "./register";
import type { RegistrationFrame, SimilarityTransform } from "./types";

function apply(transform: SimilarityTransform, x: number, y: number) {
  const c = transform.c ?? -transform.b;
  const d = transform.d ?? transform.a;
  return {
    x: transform.a * x + c * y + transform.tx,
    y: transform.b * x + d * y + transform.ty,
  };
}

function makeReference(width: number, height: number): RegistrationFrame {
  const data = new Uint8Array(width * height * 3);
  let state = 123456789;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const checker = ((Math.floor(x / 17) + Math.floor(y / 13)) & 1) * 70;
      const rings = Math.round(
        45 * Math.sin(Math.hypot(x - 83, y - 61) * 0.19),
      );
      const line = Math.abs(y - (0.37 * x + 18)) < 3 ? 90 : 0;
      const noise = (state >>> 28) * 2;
      const value = Math.max(
        0,
        Math.min(255, 75 + checker + rings + line + noise),
      );
      const index = (y * width + x) * 3;
      data[index] = value;
      data[index + 1] = Math.max(0, Math.min(255, value * 0.85 + x * 0.25));
      data[index + 2] = Math.max(0, Math.min(255, value * 0.7 + y * 0.35));
    }
  }
  return { width, height, data, components: 3 };
}

function warpMoving(
  reference: RegistrationFrame,
  transform: SimilarityTransform,
): RegistrationFrame {
  const data = new Uint8Array(reference.data.length);
  for (let y = 0; y < reference.height; y++) {
    for (let x = 0; x < reference.width; x++) {
      const source = apply(transform, x, y);
      const sx = Math.round(source.x);
      const sy = Math.round(source.y);
      const targetIndex = (y * reference.width + x) * 3;
      if (sx < 0 || sy < 0 || sx >= reference.width || sy >= reference.height)
        continue;
      const sourceIndex = (sy * reference.width + sx) * 3;
      data[targetIndex] = reference.data[sourceIndex];
      data[targetIndex + 1] = reference.data[sourceIndex + 1];
      data[targetIndex + 2] = reference.data[sourceIndex + 2];
    }
  }
  // Simulate a real generative edit that must be treated as an outlier.
  for (
    let y = Math.floor(reference.height * 0.28);
    y < Math.floor(reference.height * 0.64);
    y++
  ) {
    for (
      let x = Math.floor(reference.width * 0.54);
      x < Math.floor(reference.width * 0.86);
      x++
    ) {
      const index = (y * reference.width + x) * 3;
      data[index] = 235;
      data[index + 1] = (x * 7 + y * 3) & 255;
      data[index + 2] = 30;
    }
  }
  return { ...reference, data };
}

function replaceLargeCentralSubject(
  frame: RegistrationFrame,
): RegistrationFrame {
  const data = new Uint8Array(frame.data);
  for (let y = 0; y < Math.floor(frame.height * 0.76); y++) {
    for (
      let x = Math.floor(frame.width * 0.18);
      x < Math.floor(frame.width * 0.88);
      x++
    ) {
      const index = (y * frame.width + x) * 3;
      data[index] = (x * 11 + y * 3) & 255;
      data[index + 1] = 225;
      data[index + 2] = (x * 5 + y * 13) & 255;
    }
  }
  return { ...frame, data };
}

describe("robust image registration", () => {
  it("refits independent X/Y scales without introducing shear", () => {
    const angle = 0;
    const scaleX = 1.045;
    const scaleY = 0.985;
    const expected: SimilarityTransform = {
      a: Math.cos(angle) * scaleX,
      b: Math.sin(angle) * scaleX,
      c: -Math.sin(angle) * scaleY,
      d: Math.cos(angle) * scaleY,
      tx: 7,
      ty: -5,
    };
    const matches: PointMatch[] = [];
    for (let y = 20; y <= 140; y += 24) {
      for (let x = 20; x <= 200; x += 30) {
        const point = apply(expected, x, y);
        matches.push({
          movingX: x,
          movingY: y,
          referenceX: point.x + Math.sin(x) * 0.02,
          referenceY: point.y + Math.cos(y) * 0.02,
        });
      }
    }
    const averageScale = Math.sqrt(scaleX * scaleY);
    const initialAngle = (3 * Math.PI) / 180;
    const initial: SimilarityTransform = {
      a: Math.cos(initialAngle) * averageScale,
      b: Math.sin(initialAngle) * averageScale,
      tx: 7,
      ty: -5,
    };
    const result = refitAnisotropic(matches, initial, 220, 160);
    expect(result).not.toBeNull();
    expect(Math.hypot(result!.a, result!.b)).toBeCloseTo(scaleX, 3);
    expect(Math.hypot(result!.c!, result!.d!)).toBeCloseTo(scaleY, 3);
    expect(result!.tx).toBeCloseTo(expected.tx, 1);
    expect(result!.ty).toBeCloseTo(expected.ty, 1);
    expect(result!.b).toBe(0);
    expect(result!.c).toBe(0);
  });

  it("rejects anisotropic fitting when anchors do not span both axes", () => {
    const matches: PointMatch[] = Array.from({ length: 12 }, (_, index) => ({
      movingX: 20 + index * 14,
      movingY: 60 + (index % 2),
      referenceX: 24 + index * 14,
      referenceY: 57 + (index % 2),
    }));
    expect(
      refitAnisotropic(matches, { a: 1, b: 0, tx: 4, ty: -3 }, 220, 160),
    ).toBeNull();
  });

  it("fits scale and translation while rejecting many outliers", () => {
    const angle = 0;
    const expected: SimilarityTransform = {
      a: 1.08 * Math.cos(angle),
      b: 1.08 * Math.sin(angle),
      tx: 11,
      ty: -7,
    };
    const matches: PointMatch[] = [];
    for (let y = 15; y <= 135; y += 20) {
      for (let x = 15; x <= 195; x += 30) {
        const point = apply(expected, x, y);
        matches.push({
          movingX: x,
          movingY: y,
          referenceX: point.x + Math.sin(x) * 0.15,
          referenceY: point.y + Math.cos(y) * 0.15,
        });
      }
    }
    for (let i = 0; i < 32; i++) {
      matches.push({
        movingX: (i * 37) % 220,
        movingY: (i * 53) % 160,
        referenceX: (i * 83 + 19) % 220,
        referenceY: (i * 71 + 7) % 160,
      });
    }
    const result = estimateSimilarityRansac(matches, 220, 160);
    expect(result).not.toBeNull();
    expect(result!.inliers.length).toBeGreaterThan(40);
    expect(result!.transform.a).toBeCloseTo(expected.a, 2);
    expect(result!.transform.b).toBeCloseTo(expected.b, 2);
    expect(result!.transform.tx).toBeCloseTo(expected.tx, 0);
    expect(result!.transform.ty).toBeCloseTo(expected.ty, 0);
    expect(result!.coverage).toBeGreaterThan(0.45);
  });

  it("locks rotation to zero even when feature matches suggest rotation", () => {
    const angle = (5 * Math.PI) / 180;
    const rotated: SimilarityTransform = {
      a: Math.cos(angle),
      b: Math.sin(angle),
      tx: 8,
      ty: -6,
    };
    const matches: PointMatch[] = [];
    for (let y = 20; y <= 140; y += 20) {
      for (let x = 20; x <= 200; x += 30) {
        const point = apply(rotated, x, y);
        matches.push({
          movingX: x,
          movingY: y,
          referenceX: point.x,
          referenceY: point.y,
        });
      }
    }

    const result = estimateSimilarityRansac(matches, 220, 160);

    expect(result).not.toBeNull();
    expect(result!.transform.b).toBe(0);
  });

  it("aligns structure despite a large locally modified region", () => {
    const width = 480;
    const height = 320;
    const angle = 0;
    const expected: SimilarityTransform = {
      a: 0.94 * Math.cos(angle),
      b: 0.94 * Math.sin(angle),
      tx: 18,
      ty: 12,
    };
    const reference = makeReference(width, height);
    const moving = warpMoving(reference, expected);
    const result = registerImages(reference, moving, {
      minInliers: 10,
      minCoverage: 0.06,
      maxKeypoints: 720,
    });
    expect(result.success, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.diagnostics.inliers).toBeGreaterThanOrEqual(10);
    expect(result.diagnostics.coverage).toBeGreaterThan(0.06);
    expect(result.diagnostics.scale).toBeCloseTo(0.94, 1);
    expect(result.diagnostics.rotationDegrees).toBe(0);
    expect(result.diagnostics.translationX).toBeCloseTo(18, -1);
    expect(result.diagnostics.translationY).toBeCloseTo(12, -1);
  });

  it("can force an estimated transform through failed quality acceptance", () => {
    const width = 480;
    const height = 320;
    const expected: SimilarityTransform = {
      a: 0.99,
      b: 0,
      tx: 7,
      ty: -5,
    };
    const reference = makeReference(width, height);
    const moving = warpMoving(reference, expected);
    const rejectionOptions = {
      minInliers: 10,
      minCoverage: 0.99,
      minLocalAnchorInliers: 1000,
      maxKeypoints: 720,
    };

    const rejected = registerImages(reference, moving, rejectionOptions);
    const forced = registerImages(reference, moving, {
      ...rejectionOptions,
      forceApplyResult: true,
    });

    expect(rejected.success).toBe(false);
    expect(forced.success, JSON.stringify(forced.diagnostics)).toBe(true);
    expect(forced.diagnostics.acceptanceMode).toBe("forced");
    expect(forced.diagnostics.forced).toBe(true);
    expect(forced.transform.tx).toBeCloseTo(expected.tx, 0);
    expect(forced.transform.ty).toBeCloseTo(expected.ty, 0);
  });

  it("uses non-uniform scaling only when distributed image evidence supports it", () => {
    const width = 480;
    const height = 320;
    const angle = 0;
    const expected: SimilarityTransform = {
      a: 1.035 * Math.cos(angle),
      b: 1.035 * Math.sin(angle),
      c: -0.985 * Math.sin(angle),
      d: 0.985 * Math.cos(angle),
      tx: 8,
      ty: -6,
    };
    const reference = makeReference(width, height);
    const moving = warpMoving(reference, expected);
    const result = registerImages(reference, moving, {
      minInliers: 10,
      minCoverage: 0.06,
      maxKeypoints: 760,
    });
    expect(result.success, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.model).toBe("anisotropic");
    expect(result.diagnostics.anisotropicAccepted).toBe(true);
    expect(result.diagnostics.scaleX).toBeCloseTo(1.035, 1);
    expect(result.diagnostics.scaleY).toBeCloseTo(0.985, 1);
  });

  it("lets subpixel refinement recover a small X/Y scale difference", () => {
    const width = 480;
    const height = 320;
    const angle = 0;
    const expected: SimilarityTransform = {
      a: 1.006 * Math.cos(angle),
      b: 1.006 * Math.sin(angle),
      c: -0.996 * Math.sin(angle),
      d: 0.996 * Math.cos(angle),
      tx: 3.5,
      ty: -2.5,
    };
    const reference = makeReference(width, height);
    const moving = warpMoving(reference, expected);
    const sharedOptions = {
      minInliers: 10,
      minCoverage: 0.06,
      maxKeypoints: 760,
    };

    const refined = registerImages(reference, moving, sharedOptions);
    const similarityOnly = registerImages(reference, moving, {
      ...sharedOptions,
      enableAnisotropicRefinement: false,
    });

    expect(refined.success, JSON.stringify(refined.diagnostics)).toBe(true);
    expect(refined.model).toBe("anisotropic");
    expect(refined.diagnostics.anisotropicAccepted).toBe(true);
    expect(refined.diagnostics.anisotropicScoreGain).toBeGreaterThan(0);
    expect(refined.diagnostics.scaleX).toBeCloseTo(1.006, 2);
    expect(refined.diagnostics.scaleY).toBeCloseTo(0.996, 2);
    expect(similarityOnly.diagnostics.anisotropicAccepted).toBe(false);
    expect(similarityOnly.model).not.toBe("anisotropic");
  });

  it("keeps a refined anisotropic candidate inside the configured limit", () => {
    const width = 480;
    const height = 320;
    const expected: SimilarityTransform = {
      a: 1.01,
      b: 0,
      c: 0,
      d: 0.99,
      tx: 2,
      ty: -2,
    };
    const reference = makeReference(width, height);
    const moving = warpMoving(reference, expected);
    const result = registerImages(reference, moving, {
      minInliers: 10,
      minCoverage: 0.06,
      maxKeypoints: 760,
      maxAnisotropy: 0.005,
    });

    expect(result.success, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.diagnostics.anisotropicAccepted).toBe(false);
    expect(result.diagnostics.anisotropy).toBeLessThanOrEqual(0.005);
    expect(result.diagnostics.anisotropicRejectionReason).toBe(
      "anisotropic transform exceeds limits",
    );
  });

  it("matches features at 640 while refining a larger captured frame", () => {
    const width = 720;
    const height = 480;
    const angle = 0;
    const expected: SimilarityTransform = {
      a: 1.004 * Math.cos(angle),
      b: 1.004 * Math.sin(angle),
      c: -0.997 * Math.sin(angle),
      d: 0.997 * Math.cos(angle),
      tx: 5.5,
      ty: -4.25,
    };
    const reference = makeReference(width, height);
    const moving = warpMoving(reference, expected);
    const result = registerImages(reference, moving, {
      minInliers: 10,
      minCoverage: 0.06,
      maxKeypoints: 760,
    });

    expect(result.success, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.diagnostics.featureFrameWidth).toBe(640);
    expect(result.diagnostics.featureFrameHeight).toBe(427);
    expect(result.diagnostics.refinementFrameWidth).toBe(width);
    expect(result.diagnostics.refinementFrameHeight).toBe(height);
    expect(result.diagnostics.translationX).toBeCloseTo(expected.tx, 0);
    expect(result.diagnostics.translationY).toBeCloseTo(expected.ty, 0);
  });

  it("uses distributed local anchors when a large central subject changed", () => {
    const width = 480;
    const height = 320;
    const angle = 0;
    const expected: SimilarityTransform = {
      a: 1.035 * Math.cos(angle),
      b: 1.035 * Math.sin(angle),
      tx: -9,
      ty: 8,
    };
    const reference = makeReference(width, height);
    const moving = replaceLargeCentralSubject(warpMoving(reference, expected));
    const result = registerImages(reference, moving, {
      minInliers: 24,
      minCoverage: 0.35,
      minLocalAnchorInliers: 6,
      maxKeypoints: 800,
    });
    expect(result.success, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.diagnostics.acceptanceMode).toBe("local-anchors");
    expect(result.diagnostics.anchorCells).toBeGreaterThanOrEqual(3);
    expect(result.diagnostics.anchorSpread).toBeGreaterThanOrEqual(0.18);
    expect(result.diagnostics.scale).toBeCloseTo(1.035, 1);
    expect(result.diagnostics.rotationDegrees).toBe(0);
  });

  it("refuses unrelated images instead of inventing a transform", () => {
    const reference = makeReference(180, 140);
    const unrelated = makeReference(180, 140);
    unrelated.data.reverse();
    const result = registerImages(reference, unrelated);
    expect(result.success).toBe(false);
    expect(result.model).toBe("identity");
    expect(result.diagnostics.acceptanceMode).toBeUndefined();
  });

  it("cannot force alignment when no transform can be estimated", () => {
    const blank: RegistrationFrame = {
      width: 180,
      height: 140,
      components: 3,
      data: new Uint8Array(180 * 140 * 3),
    };
    const result = registerImages(blank, blank, { forceApplyResult: true });
    expect(result.success).toBe(false);
    expect(result.model).toBe("identity");
    expect(result.diagnostics.acceptanceMode).toBeUndefined();
  });

  it("refuses a concentrated unchanged patch as a global alignment anchor", () => {
    const width = 360;
    const height = 240;
    const reference = makeReference(width, height);
    const unrelated = makeReference(width, height);
    unrelated.data.reverse();
    for (let y = 0; y < 52; y++) {
      for (let x = 0; x < 52; x++) {
        const offset = (y * width + x) * 3;
        unrelated.data[offset] = reference.data[offset];
        unrelated.data[offset + 1] = reference.data[offset + 1];
        unrelated.data[offset + 2] = reference.data[offset + 2];
      }
    }
    const result = registerImages(reference, unrelated, {
      minLocalAnchorInliers: 4,
      maxKeypoints: 720,
    });
    expect(result.success, JSON.stringify(result.diagnostics)).toBe(false);
    expect(result.model).toBe("identity");
  });
});
