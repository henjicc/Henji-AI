struct LayerParams {
  inverseLinear: vec4f,
  inverseTranslationOpacity: vec4f,
  tileOrigin: vec4f,
}

struct CameraParams {
  documentOriginScale: vec4f,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: LayerParams;
@group(1) @binding(0) var<uniform> camera: CameraParams;

fn decodeSrgb(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn loadLinearPremultiplied(coord: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  if (coord.x < 0 || coord.y < 0 || coord.x >= size.x || coord.y >= size.y) {
    return vec4f(0.0);
  }
  let encoded = textureLoad(sourceTexture, coord, 0);
  let linear = vec3f(
    decodeSrgb(encoded.r),
    decodeSrgb(encoded.g),
    decodeSrgb(encoded.b),
  );
  return vec4f(linear * encoded.a, encoded.a);
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
  let documentPoint = position.xy / cameraParams.z + cameraParams.xy;
  let sourcePoint = vec2f(
    inverse.x * documentPoint.x + inverse.z * documentPoint.y + extra.x,
    inverse.y * documentPoint.x + inverse.w * documentPoint.y + extra.y,
  );
  let local = sourcePoint - params.tileOrigin.xy - vec2f(0.5);
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
