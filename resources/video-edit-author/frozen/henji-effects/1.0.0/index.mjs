// src/features/videoEdit/authorLibraries/effects.generated.ts
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
function blur(params = {}) {
  const { mode = "gaussian", ...values } = params;
  const id = { "gaussian": "gaussian_blur", "directional": "directional_blur", "radial": "zoom_blur", "lens": "lens_blur" }[mode];
  if (!id) throw new Error("\u672A\u77E5 blur.mode");
  return { id, params: values };
}

// src/features/videoEdit/authorLibraries/effects.ts
function look(name, knobs) {
  if (typeof name !== "string" || !name.trim()) throw new Error("look.name \u5FC5\u987B\u662F\u975E\u7A7A\u540D\u79F0\u3002");
  if (knobs !== void 0 && (!knobs || typeof knobs !== "object" || Array.isArray(knobs) || Object.keys(knobs).length)) throw new Error("look \u672C\u7248\u672C\u4E0D\u652F\u6301\u65CB\u94AE\u3002");
  return { id: "look", params: { name } };
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
