struct LayerParams {
  inverseLinear: vec4f,
  inverseTranslationOpacity: vec4f,
  tileOriginScaleLayer: vec4f,
  tileSizeTransferWhite: vec4f,
  coreRect: vec4f,
  colorRow0: vec4f,
  colorRow1: vec4f,
  colorRow2: vec4f,
}

struct CameraParams {
  documentOriginScale: vec4f,
  geometry: vec4f,
  orientation: vec4f,
}

@group(0) @binding(0) var sourceAtlas: texture_2d_array<f32>;
@group(0) @binding(1) var<uniform> params: LayerParams;
@group(1) @binding(0) var<uniform> camera: CameraParams;

fn outputToDocument(outputPoint: vec2f) -> vec2f {
  let oriented = outputPoint + camera.geometry.zw;
  let rotate = u32(camera.orientation.x);
  var mirroredX = oriented.x;
  var sourceY = oriented.y;
  if (rotate == 1u) {
    mirroredX = oriented.y;
    sourceY = camera.geometry.y - oriented.x;
  } else if (rotate == 2u) {
    mirroredX = camera.geometry.x - oriented.x;
    sourceY = camera.geometry.y - oriented.y;
  } else if (rotate == 3u) {
    mirroredX = camera.geometry.x - oriented.y;
    sourceY = oriented.x;
  }
  let sourceX = select(mirroredX, camera.geometry.x - mirroredX, camera.orientation.y > 0.5);
  return vec2f(sourceX, sourceY);
}

fn decodeSrgb(value: f32) -> f32 {
  let magnitude = abs(value);
  let decoded = select(pow((magnitude + 0.055) / 1.055, 2.4), magnitude / 12.92, magnitude <= 0.04045);
  return sign(value) * decoded;
}

fn decodePq(value: f32, referenceWhiteNits: f32) -> f32 {
  let m1 = 2610.0 / 16384.0;
  let m2 = 2523.0 / 32.0;
  let c1 = 3424.0 / 4096.0;
  let c2 = 2413.0 / 128.0;
  let c3 = 2392.0 / 128.0;
  let power = pow(clamp(value, 0.0, 1.0), 1.0 / m2);
  let denominator = c2 - c3 * power;
  let normalizedNits = select(
    pow(max(power - c1, 0.0) / denominator, 1.0 / m1),
    1.0,
    denominator <= 0.0,
  );
  return normalizedNits * 10000.0 / referenceWhiteNits;
}

fn decodeHlg(value: f32) -> f32 {
  let encoded = clamp(value, 0.0, 1.0);
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  return select(
    (exp((encoded - c) / a) + b) / 12.0,
    encoded * encoded / 3.0,
    encoded <= 0.5,
  );
}

fn decodeTransfer(value: f32) -> f32 {
  let code = params.tileSizeTransferWhite.z;
  if (code < 0.5) { return value; }
  if (code < 1.5) { return decodeSrgb(value); }
  if (code < 2.5) { return decodePq(value, params.tileSizeTransferWhite.w); }
  return decodeHlg(value);
}

fn loadLinearPremultiplied(coord: vec2i) -> vec4f {
  let tileSize = vec2i(params.tileSizeTransferWhite.xy);
  if (coord.x < 0 || coord.y < 0 || coord.x >= tileSize.x || coord.y >= tileSize.y) {
    return vec4f(0.0);
  }
  let encoded = textureLoad(sourceAtlas, coord, i32(params.tileOriginScaleLayer.w), 0);
  let linearSource = vec3f(
    decodeTransfer(encoded.r),
    decodeTransfer(encoded.g),
    decodeTransfer(encoded.b),
  );
  let linearWorking = vec3f(
    dot(params.colorRow0.xyz, linearSource),
    dot(params.colorRow1.xyz, linearSource),
    dot(params.colorRow2.xyz, linearSource),
  );
  return vec4f(linearWorking * encoded.a, encoded.a);
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let inverse = params.inverseLinear;
  let extra = params.inverseTranslationOpacity;
  let cameraParams = camera.documentOriginScale;
  let outputPoint = position.xy / cameraParams.z + cameraParams.xy;
  let documentPoint = outputToDocument(outputPoint);
  let sourcePoint = vec2f(
    inverse.x * documentPoint.x + inverse.z * documentPoint.y + extra.x,
    inverse.y * documentPoint.x + inverse.w * documentPoint.y + extra.y,
  );
  let sourceMipPoint = sourcePoint / params.tileOriginScaleLayer.z;
  let core = params.coreRect;
  if (sourceMipPoint.x < core.x || sourceMipPoint.y < core.y
    || sourceMipPoint.x >= core.x + core.z || sourceMipPoint.y >= core.y + core.w) {
    discard;
  }
  let local = sourceMipPoint - params.tileOriginScaleLayer.xy - vec2f(0.5);
  let p0 = vec2i(floor(local));
  let fraction = fract(local);
  let top = mix(
    loadLinearPremultiplied(p0),
    loadLinearPremultiplied(p0 + vec2i(1, 0)),
    fraction.x,
  );
  let bottom = mix(
    loadLinearPremultiplied(p0 + vec2i(0, 1)),
    loadLinearPremultiplied(p0 + vec2i(1, 1)),
    fraction.x,
  );
  return mix(top, bottom, fraction.y) * extra.z;
}
