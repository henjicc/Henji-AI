struct TileParams {
  inverseLinear: vec4f,
  inverseTranslation: vec4f,
  tileOriginScaleLayer: vec4f,
  tileSize: vec4f,
  coreRect: vec4f,
}
struct CameraParams {
  documentOriginScale: vec4f,
  geometry: vec4f,
  orientation: vec4f,
}
@group(0) @binding(0) var maskAtlas: texture_2d_array<f32>;
@group(0) @binding(1) var<uniform> params: TileParams;
@group(1) @binding(0) var<uniform> camera: CameraParams;

fn outputToDocument(outputPoint: vec2f) -> vec2f {
  let oriented = outputPoint + camera.geometry.zw;
  let rotate = u32(camera.orientation.x);
  var mirroredX = oriented.x;
  var sourceY = oriented.y;
  if (rotate == 1u) { mirroredX = oriented.y; sourceY = camera.geometry.y - oriented.x; }
  else if (rotate == 2u) { mirroredX = camera.geometry.x - oriented.x; sourceY = camera.geometry.y - oriented.y; }
  else if (rotate == 3u) { mirroredX = camera.geometry.x - oriented.y; sourceY = oriented.x; }
  return vec2f(select(mirroredX, camera.geometry.x - mirroredX, camera.orientation.y > 0.5), sourceY);
}
fn loadMask(coord: vec2i) -> f32 {
  let size = vec2i(params.tileSize.xy);
  if (any(coord < vec2i(0)) || any(coord >= size)) { return 0.0; }
  return textureLoad(maskAtlas, coord, i32(params.tileOriginScaleLayer.w), 0).r;
}
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[vi], 0, 1);
}
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let outputPoint = position.xy / camera.documentOriginScale.z + camera.documentOriginScale.xy;
  let documentPoint = outputToDocument(outputPoint);
  let inverse = params.inverseLinear;
  let sourcePoint = vec2f(
    inverse.x * documentPoint.x + inverse.z * documentPoint.y + params.inverseTranslation.x,
    inverse.y * documentPoint.x + inverse.w * documentPoint.y + params.inverseTranslation.y
  );
  let mipPoint = sourcePoint / params.tileOriginScaleLayer.z;
  let core = params.coreRect;
  if (mipPoint.x < core.x || mipPoint.y < core.y
    || mipPoint.x >= core.x + core.z || mipPoint.y >= core.y + core.w) { discard; }
  let local = mipPoint - params.tileOriginScaleLayer.xy - vec2f(0.5);
  let p0 = vec2i(floor(local));
  let f = fract(local);
  let value = mix(
    mix(loadMask(p0), loadMask(p0 + vec2i(1, 0)), f.x),
    mix(loadMask(p0 + vec2i(0, 1)), loadMask(p0 + vec2i(1, 1)), f.x), f.y
  );
  return vec4f(value, value, value, 1.0);
}
