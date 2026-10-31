// src/features/videoEdit/authorLibraries/effects.generated.ts
function blur(params = {}) {
  return { id: "blur", params };
}
function sharpen(params = {}) {
  return { id: "sharpen", params };
}
function blackWhite(params = {}) {
  return { id: "black_white", params };
}
function mosaic(params = {}) {
  return { id: "mosaic", params };
}
function chromaticAberration(params = {}) {
  return { id: "chromatic_aberration", params };
}
function glow(params = {}) {
  return { id: "glow", params };
}
function colorGrade(params = {}) {
  return { id: "color_grade", params };
}

// src/features/videoEdit/authorLibraries/effects.ts
function look(name, knobs) {
  if (typeof name !== "string" || !name.trim()) throw new Error("look.name \u5FC5\u987B\u662F\u975E\u7A7A\u540D\u79F0\u3002");
  if (knobs !== void 0 && (!knobs || typeof knobs !== "object" || Array.isArray(knobs) || Object.values(knobs).some((value) => typeof value !== "number" || !Number.isFinite(value)))) throw new Error("look \u65CB\u94AE\u5FC5\u987B\u662F\u6709\u9650\u6570\u503C\u7684\u5BF9\u8C61\u3002");
  return { id: "look", params: { name, ...knobs === void 0 ? {} : { knobs: { ...knobs } } } };
}
export {
  blackWhite,
  blur,
  chromaticAberration,
  colorGrade,
  glow,
  look,
  mosaic,
  sharpen
};
