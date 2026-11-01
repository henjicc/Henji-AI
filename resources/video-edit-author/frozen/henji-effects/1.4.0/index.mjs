// src/features/videoEdit/authorLibraries/effects.generated.ts
function blur(params = {}, options = {}) {
  return { id: "blur", params, ...options };
}
function sharpen(params = {}, options = {}) {
  return { id: "sharpen", params, ...options };
}
function colorGrade(params = {}, options = {}) {
  return { id: "color_grade", params, ...options };
}
function blackWhite(params = {}, options = {}) {
  return { id: "black_white", params, ...options };
}
function invert(params = {}, options = {}) {
  return { id: "invert", params, ...options };
}
function gradientMap(params = {}, options = {}) {
  return { id: "gradient_map", params, ...options };
}
function posterize(params = {}, options = {}) {
  return { id: "posterize", params, ...options };
}
function glow(params = {}, options = {}) {
  return { id: "glow", params, ...options };
}
function lightSweep(params = {}, options = {}) {
  return { id: "light_sweep", params, ...options };
}
function lensFlare(params = {}, options = {}) {
  return { id: "lens_flare", params, ...options };
}
function lightLeak(params = {}, options = {}) {
  return { id: "light_leak", params, ...options };
}
function shadow(params = {}, options = {}) {
  return { id: "drop_shadow", params, ...options };
}
function stroke(params = {}, options = {}) {
  return { id: "stroke", params, ...options };
}
function vignette(params = {}, options = {}) {
  return { id: "vignette", params, ...options };
}
function chromaticAberration(params = {}, options = {}) {
  return { id: "chromatic_aberration", params, ...options };
}
function grain(params = {}, options = {}) {
  return { id: "film_grain", params, ...options };
}
function halftone(params = {}, options = {}) {
  return { id: "halftone", params, ...options };
}
function ditherPattern(params = {}, options = {}) {
  return { id: "dither_pattern", params, ...options };
}
function paper(params = {}, options = {}) {
  return { id: "paper", params, ...options };
}
function scratches(params = {}, options = {}) {
  return { id: "scratches", params, ...options };
}
function mosaic(params = {}, options = {}) {
  return { id: "mosaic", params, ...options };
}
function glitch(params = {}, options = {}) {
  return { id: "glitch", params, ...options };
}
function dissolve(params = {}, options = {}) {
  return { id: "dissolve_reveal", params, ...options };
}
function mirror(params = {}, options = {}) {
  return { id: "mirror", params, ...options };
}
function repeat(params = {}, options = {}) {
  return { id: "repeat", params, ...options };
}
function bulge(params = {}, options = {}) {
  return { id: "bulge", params, ...options };
}
function twirl(params = {}, options = {}) {
  return { id: "twirl", params, ...options };
}
function wave(params = {}, options = {}) {
  return { id: "wave", params, ...options };
}
function cornerPin(params = {}, options = {}) {
  return { id: "corner_pin", params, ...options };
}
function displace(params = {}, options = {}) {
  return { id: "displace", params, ...options };
}
function gradient(params = {}, options = {}) {
  return { id: "gradient", params, ...options };
}

// src/features/videoEdit/authorLibraries/effects.ts
function look(name, knobs, options = {}) {
  if (typeof name !== "string" || !name.trim()) throw new Error("look.name \u5FC5\u987B\u662F\u975E\u7A7A\u540D\u79F0\u3002");
  if (knobs !== void 0 && (!knobs || typeof knobs !== "object" || Array.isArray(knobs) || Object.values(knobs).some((value) => typeof value !== "number" || !Number.isFinite(value)))) throw new Error("look \u65CB\u94AE\u5FC5\u987B\u662F\u6709\u9650\u6570\u503C\u7684\u5BF9\u8C61\u3002");
  return { id: "look", ...options, params: { name, ...knobs === void 0 ? {} : { knobs: { ...knobs } } } };
}
export {
  blackWhite,
  blur,
  bulge,
  chromaticAberration,
  colorGrade,
  cornerPin,
  displace,
  dissolve,
  ditherPattern,
  glitch,
  glow,
  gradient,
  gradientMap,
  grain,
  halftone,
  invert,
  lensFlare,
  lightLeak,
  lightSweep,
  look,
  mirror,
  mosaic,
  paper,
  posterize,
  repeat,
  scratches,
  shadow,
  sharpen,
  stroke,
  twirl,
  vignette,
  wave
};
