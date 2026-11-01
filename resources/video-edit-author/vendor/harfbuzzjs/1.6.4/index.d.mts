//#region src/helpers.d.ts
type ValueOf<T> = T[keyof T];
//#endregion
//#region src/types.d.ts
interface FontExtents {
  ascender: number;
  descender: number;
  lineGap: number;
}
interface GlyphExtents {
  xBearing: number;
  yBearing: number;
  width: number;
  height: number;
}
interface GlyphInfo {
  /** Either a Unicode code point (before shaping) or a glyph index (after shaping). */
  codepoint: number;
  /** The cluster index of the glyph. */
  cluster: number;
  /** Glyph flags, a combination of {@link GlyphFlag} values. */
  flags: number;
}
interface GlyphPosition {
  /** The x advance of the glyph. */
  xAdvance: number;
  /** The y advance of the glyph. */
  yAdvance: number;
  /** The x offset of the glyph. */
  xOffset: number;
  /** The y offset of the glyph. */
  yOffset: number;
}
interface SvgPathCommand {
  type: string;
  values: number[];
}
/** A color value, eight bits per channel RGB plus alpha transparency. */
interface Color {
  /** Red channel value. */
  red: number;
  /** Green channel value. */
  green: number;
  /** Blue channel value. */
  blue: number;
  /** Alpha channel value. */
  alpha: number;
}
/**
 * Information about a color stop on a {@link ColorLine}.
 *
 * Color lines typically have offsets ranging between 0 and 1, but that is not
 * required.
 *
 * The `isForeground` and `color` fields have the same semantics as in
 * {@link PaintFuncs.setColorFunc}.
 *
 * Note: despite `color` being unpremultiplied here, interpolation in gradients
 * shall happen in premultiplied space. See the OpenType spec
 * [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr)
 * section for details.
 */
interface ColorStop {
  /** The offset of the color stop. */
  offset: number;
  /** Whether the color is the foreground. */
  isForeground: boolean;
  /** The color, unpremultiplied. */
  color: Color;
}
/** Color information for a gradient. */
interface ColorLine {
  /** The extend mode of the color line. */
  extend: PaintExtend;
  /**
   * The color stops.
   *
   * Note that due to variations being applied, the color stops may be out of
   * order; it is the caller's responsibility to ensure they are sorted by their
   * offset before they are used.
   */
  colorStops: ColorStop[];
}
/** Flags that describe the properties of a color palette. */
declare const ColorPaletteFlags: {
  /**
   * Default indicating that there is nothing special to note about a color
   * palette.
   */
  readonly DEFAULT: 0;
  /**
   * Flag indicating that the color palette is appropriate to use when displaying
   * the font on a light background such as white.
   */
  readonly USABLE_WITH_LIGHT_BACKGROUND: 1;
  /**
   * Flag indicating that the color palette is appropriate to use when displaying
   * the font on a dark background such as black.
   */
  readonly USABLE_WITH_DARK_BACKGROUND: 2;
};
type ColorPaletteFlags = ValueOf<typeof ColorPaletteFlags>;
/** A {@link Color} from a font's color palette, together with its name ID. */
interface PaletteColor extends Color {
  /**
   * The `name` table Name ID that provides display names for the color, or
   * `undefined` if the color has no name.
   *
   * Display names can be generic (e.g., "Background") or specific (e.g., "Eye
   * color").
   */
  nameId?: number;
}
/** A color palette from a font's `CPAL` table. */
interface ColorPalette {
  /**
   * The colors that make up the palette. The RGBA values are unpremultiplied;
   * see the OpenType spec
   * [CPAL](https://learn.microsoft.com/en-us/typography/opentype/spec/cpal)
   * section for details.
   */
  colors: PaletteColor[];
  /**
   * The `name` table Name ID that provides display names for the palette, or
   * `undefined` if the palette has no name.
   *
   * Palette display names can be generic (e.g., "Default") or provide specific,
   * themed names (e.g., "Spring", "Summer", "Fall", and "Winter").
   */
  nameId?: number;
  /**
   * The flags defined for the palette, a combination of
   * {@link ColorPaletteFlags} values.
   */
  flags: number;
}
/**
 * Pairs of glyph and color index.
 *
 * A color index of `undefined` does not refer to a palette color, but indicates
 * that the foreground color should be used.
 */
interface ColorLayer {
  /** The glyph ID of the layer. */
  glyph: number;
  /** The palette color index of the layer. */
  colorIndex?: number;
}
/**
 * The values of this enumeration determine how color values outside the minimum
 * and maximum defined offset on a {@link ColorLine} are determined.
 *
 * See the OpenType spec
 * [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr) section
 * for details.
 */
declare const PaintExtend: {
  /** Outside the defined interval, the color of the closest color stop is used. */readonly PAD: 0; /** The color line is repeated over repeated multiples of the defined interval */
  readonly REPEAT: 1;
  /**
   * The color line is repeated over repeated intervals, as for the repeat mode.
   * However, in each repeated interval, the ordering of color stops is the
   * reverse of the adjacent interval.
   */
  readonly REFLECT: 2;
};
type PaintExtend = ValueOf<typeof PaintExtend>;
/**
 * The values of this enumeration describe the compositing modes that can be used
 * when combining temporary redirected drawing with the backdrop.
 *
 * See the OpenType spec
 * [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr) section
 * for details.
 */
declare const PaintCompositeMode: {
  /** clear destination layer (bounded) */readonly CLEAR: 0; /** replace destination layer (bounded) */
  readonly SRC: 1; /** ignore the source */
  readonly DEST: 2; /** draw source layer on top of destination layer (bounded) */
  readonly SRC_OVER: 3; /** draw destination on top of source */
  readonly DEST_OVER: 4; /** draw source where there was destination content (unbounded) */
  readonly SRC_IN: 5; /** leave destination only where there was source content (unbounded) */
  readonly DEST_IN: 6; /** draw source where there was no destination content (unbounded) */
  readonly SRC_OUT: 7; /** leave destination only where there was no source content */
  readonly DEST_OUT: 8; /** draw source on top of destination content and only there */
  readonly SRC_ATOP: 9; /** leave destination on top of source content and only there (unbounded) */
  readonly DEST_ATOP: 10; /** source and destination are shown where there is only one of them */
  readonly XOR: 11; /** source and destination layers are accumulated */
  readonly PLUS: 12;
  /**
   * source and destination are complemented and multiplied. This causes the
   * result to be at least as light as the lighter inputs.
   */
  readonly SCREEN: 13; /** multiplies or screens, depending on the lightness of the destination color. */
  readonly OVERLAY: 14;
  /**
   * replaces the destination with the source if it is darker, otherwise keeps the
   * source.
   */
  readonly DARKEN: 15;
  /**
   * replaces the destination with the source if it is lighter, otherwise keeps the
   * source.
   */
  readonly LIGHTEN: 16; /** brightens the destination color to reflect the source color. */
  readonly COLOR_DODGE: 17; /** darkens the destination color to reflect the source color. */
  readonly COLOR_BURN: 18; /** Multiplies or screens, dependent on source color. */
  readonly HARD_LIGHT: 19; /** Darkens or lightens, dependent on source color. */
  readonly SOFT_LIGHT: 20; /** Takes the difference of the source and destination color. */
  readonly DIFFERENCE: 21; /** Produces an effect similar to difference, but with lower contrast. */
  readonly EXCLUSION: 22;
  /**
   * source and destination layers are multiplied. This causes the result to be at
   * least as dark as the darker inputs.
   */
  readonly MULTIPLY: 23;
  /**
   * Creates a color with the hue of the source and the saturation and luminosity
   * of the target.
   */
  readonly HSL_HUE: 24;
  /**
   * Creates a color with the saturation of the source and the hue and luminosity
   * of the target. Painting with this mode onto a gray area produces no change.
   */
  readonly HSL_SATURATION: 25;
  /**
   * Creates a color with the hue and saturation of the source and the luminosity
   * of the target. This preserves the gray levels of the target and is useful for
   * coloring monochrome images or tinting color images.
   */
  readonly HSL_COLOR: 26;
  /**
   * Creates a color with the luminosity of the source and the hue and saturation
   * of the target. This produces an inverse effect to
   * {@link PaintCompositeMode.HSL_COLOR}.
   */
  readonly HSL_LUMINOSITY: 27;
};
type PaintCompositeMode = ValueOf<typeof PaintCompositeMode>;
/** Flags for {@link AxisInfo}. */
declare const AxisFlags: {
  /** The axis should not be exposed directly in user interfaces. */readonly HIDDEN: 1;
};
type AxisFlags = ValueOf<typeof AxisFlags>;
/**
 * Data type for holding variation-axis values.
 *
 * The minimum, default, and maximum values are in un-normalized, user scales.
 */
interface AxisInfo {
  /** Index of the axis in the variation-axis array. */
  axisIndex: number;
  /** The tag identifying the design variation of the axis. */
  tag: string;
  /** The `name` table Name ID that provides display names for the axis. */
  nameId: number;
  /**
   * The {@link AxisFlags} flags for the axis.
   *
   * Note: at present, the only flag defined for `flags` is
   * {@link AxisFlags.HIDDEN}.
   */
  flags: number;
  /** The minimum value on the variation axis that the font covers. */
  min: number;
  /** The position on the variation axis corresponding to the font's defaults. */
  default: number;
  /** The maximum value on the variation axis that the font covers. */
  max: number;
}
interface NameEntry {
  nameId: number;
  language: string;
}
interface FeatureNameIds {
  uiLabelNameId?: number;
  uiTooltipTextNameId?: number;
  sampleTextNameId?: number;
  paramUiLabelNameIds: number[];
}
interface TraceEntry {
  m: string;
  t: unknown[];
  glyphs: boolean;
}
/** EmscriptenModule extended with MODULARIZE runtime methods. */
interface HarfBuzzModule extends EmscriptenModule {
  wasmExports: Record<string, (...args: any[]) => any>;
  addFunction(func: (...args: any[]) => any, signature: string): number;
  removeFunction(funcPtr: number): void;
  stackSave(): number;
  stackAlloc(size: number): number;
  stackRestore(ptr: number): void;
}
declare const GlyphFlag: {
  readonly UNSAFE_TO_BREAK: 1;
  readonly UNSAFE_TO_CONCAT: 2;
  readonly SAFE_TO_INSERT_TATWEEL: 4;
  readonly DEFINED: 7;
};
type GlyphFlag = ValueOf<typeof GlyphFlag>;
//#endregion
//#region src/blob.d.ts
/**
 * An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-blob.html | HarfBuzz blob}.
 * A blob wraps a chunk of binary data, typically the contents of a font file.
 */
declare class Blob {
  dispose(): void;
  readonly ptr: number;
  /**
   * @param data Binary font data.
   */
  constructor(data: Uint8Array | ArrayBuffer);
}
//#endregion
//#region src/face.d.ts
declare const GlyphClass: {
  readonly UNCLASSIFIED: 0;
  readonly BASE_GLYPH: 1;
  readonly LIGATURE: 2;
  readonly MARK: 3;
  readonly COMPONENT: 4;
};
type GlyphClass = ValueOf<typeof GlyphClass>;
/**
 * An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-face.html | HarfBuzz face}.
 * A face represents a single face in a binary font file and is the
 * foundation for creating Font objects used in text shaping.
 */
declare class Face {
  dispose(): void;
  readonly ptr: number;
  readonly upem: number;
  /**
   * @param blob A Blob containing font data.
   * @param index The index of the font in the blob. (0 for most files,
   *  or a 0-indexed font number if the `blob` came from a font collection file.)
   */
  constructor(blob: Blob, index?: number);
  /** @internal Wrap an existing face pointer. */
  constructor(existingPtr: number);
  /**
   * Return the binary contents of an OpenType table.
   * @param table Table name
   * @returns A Uint8Array of the table data, or undefined if the table is not found.
   */
  referenceTable(table: string): Uint8Array | undefined;
  /**
   * Return variation axis infos.
   * @returns A dictionary mapping axis tags to {@link AxisInfo} values.
   */
  getAxisInfos(): Record<string, AxisInfo>;
  /**
   * Return unicodes the face supports.
   * @returns A Uint32Array of supported Unicode code points.
   */
  collectUnicodes(): Uint32Array;
  /**
   * Return all scripts enumerated in the specified face's
   * GSUB table or GPOS table.
   * @param table The table to query, either "GSUB" or "GPOS".
   * @returns An array of 4-character script tag strings.
   */
  getTableScriptTags(table: "GSUB" | "GPOS"): string[];
  /**
   * Return all features enumerated in the specified face's
   * GSUB table or GPOS table.
   * @param table The table to query, either "GSUB" or "GPOS".
   * @returns An array of 4-character feature tag strings.
   */
  getTableFeatureTags(table: "GSUB" | "GPOS"): string[];
  /**
   * Return language tags in the given face's GSUB or GPOS table, underneath
   * the specified script index.
   * @param table The table to query, either "GSUB" or "GPOS".
   * @param scriptIndex The index of the script to query.
   * @returns An array of 4-character language tag strings.
   */
  getScriptLanguageTags(table: "GSUB" | "GPOS", scriptIndex: number): string[];
  /**
   * Return all features in the specified face's GSUB table or GPOS table,
   * underneath the specified script and language.
   * @param table The table to query, either "GSUB" or "GPOS".
   * @param scriptIndex The index of the script to query.
   * @param languageIndex The index of the language to query.
   * @returns An array of 4-character feature tag strings.
   */
  getLanguageFeatureTags(table: "GSUB" | "GPOS", scriptIndex: number, languageIndex: number): string[];
  /**
   * Fetches a list of all lookups enumerated for the specified feature, in
   * the specified face's GSUB table or GPOS table.
   * @param table The table to query, either "GSUB" or "GPOS".
   * @param featureIndex The index of the requested feature.
   * @returns An array of lookup indexes.
   */
  getFeatureLookups(table: "GSUB" | "GPOS", featureIndex: number): number[];
  /**
   * Get the GDEF class of the requested glyph.
   * @param glyph The glyph to get the class of.
   * @returns The {@link GlyphClass} of the glyph.
   */
  getGlyphClass(glyph: number): GlyphClass;
  /**
   * Return all names in the specified face's name table.
   * @returns An array of {nameId, language} entries.
   */
  listNames(): NameEntry[];
  /**
   * Get the name of the specified face.
   * @param nameId The ID of the name to get.
   * @param language The language of the name to get.
   * @returns The name string.
   */
  getName(nameId: number, language: string): string;
  /**
   * Get the name IDs of the specified feature.
   * @param table The table to query, either "GSUB" or "GPOS".
   * @param featureIndex The index of the feature to query.
   * @returns An object with name IDs, or undefined if not found.
   */
  getFeatureNameIds(table: "GSUB" | "GPOS", featureIndex: number): FeatureNameIds | undefined;
  /**
   * Tests whether a face includes a `CPAL` color-palette table.
   * @returns `true` if data found, `false` otherwise.
   */
  hasColorPalettes(): boolean;
  /**
   * Fetches the color palettes in the face's `CPAL` table.
   * @returns An array of the face's {@link ColorPalette | color palettes}.
   */
  getColorPalettes(): ColorPalette[];
  /**
   * Tests whether a face includes a `COLR` table with data according to COLRv0.
   * @returns `true` if data found, `false` otherwise.
   */
  hasColorLayers(): boolean;
  /**
   * Fetches a list of all color layers for the specified glyph index in the
   * specified face.
   * @param glyph The glyph index to query.
   * @returns An array of the glyph's {@link ColorLayer | color layers}.
   */
  getGlyphColorLayers(glyph: number): ColorLayer[];
  /**
   * Tests whether a face includes a `COLR` table with data according to COLRv1.
   * @returns `true` if data found, `false` otherwise.
   */
  hasColorPaint(): boolean;
  /**
   * Tests whether a face includes COLRv1 paint data for a glyph.
   * @param glyph The glyph index to query.
   * @returns `true` if data found, `false` otherwise.
   */
  glyphHasColorPaint(glyph: number): boolean;
  /**
   * Tests whether a face has PNG glyph images (either in `CBDT` or `sbix`
   * tables).
   * @returns `true` if data found, `false` otherwise.
   */
  hasColorPng(): boolean;
}
//#endregion
//#region src/buffer.d.ts
declare const BufferContentType: {
  readonly INVALID: 0;
  readonly UNICODE: 1;
  readonly GLYPHS: 2;
};
type BufferContentType = ValueOf<typeof BufferContentType>;
declare const BufferSerializeFlag: {
  readonly DEFAULT: 0;
  readonly NO_CLUSTERS: 1;
  readonly NO_POSITIONS: 2;
  readonly NO_GLYPH_NAMES: 4;
  readonly GLYPH_EXTENTS: 8;
  readonly GLYPH_FLAGS: 16;
  readonly NO_ADVANCES: 32;
  readonly DEFINED: 63;
};
type BufferSerializeFlag = ValueOf<typeof BufferSerializeFlag>;
declare const BufferFlag: {
  readonly DEFAULT: 0;
  readonly BOT: 1;
  readonly EOT: 2;
  readonly PRESERVE_DEFAULT_IGNORABLES: 4;
  readonly REMOVE_DEFAULT_IGNORABLES: 8;
  readonly DO_NOT_INSERT_DOTTED_CIRCLE: 16;
  readonly VERIFY: 32;
  readonly PRODUCE_UNSAFE_TO_CONCAT: 64;
  readonly PRODUCE_SAFE_TO_INSERT_TATWEEL: 128;
  readonly DEFINED: 255;
};
type BufferFlag = ValueOf<typeof BufferFlag>;
declare const Direction: {
  readonly INVALID: 0;
  readonly LTR: 4;
  readonly RTL: 5;
  readonly TTB: 6;
  readonly BTT: 7;
};
type Direction = ValueOf<typeof Direction>;
declare const ClusterLevel: {
  readonly MONOTONE_GRAPHEMES: 0;
  readonly MONOTONE_CHARACTERS: 1;
  readonly CHARACTERS: 2;
  readonly GRAPHEMES: 3;
  readonly DEFAULT: 0;
};
type ClusterLevel = ValueOf<typeof ClusterLevel>;
declare const BufferSerializeFormat: {
  readonly INVALID: 0;
  readonly TEXT: number;
  readonly JSON: number;
};
type BufferSerializeFormat = ValueOf<typeof BufferSerializeFormat>;
/**
 * An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-buffer.html | HarfBuzz buffer}.
 * A buffer holds the input text and its properties before shaping, and the
 * output glyphs and their information after shaping.
 */
declare class Buffer {
  dispose(): void;
  readonly ptr: number;
  /**
   * @param existingPtr @internal Wrap an existing buffer pointer.
   */
  constructor(existingPtr?: number);
  /**
   * Appends a character with the Unicode value of `codePoint` to the buffer,
   * and gives it the initial cluster value of `cluster`. Clusters can be any
   * thing the client wants, they are usually used to refer to the index of the
   * character in the input text stream and are output in the `cluster` field
   * of {@link GlyphInfo}.
   *
   * This function does not check the validity of `codePoint`, it is up to the
   * caller to ensure it is a valid Unicode code point.
   * @param codePoint A Unicode code point.
   * @param cluster The cluster value of `codePoint`.
   */
  add(codePoint: number, cluster: number): void;
  /**
   * Add text to the buffer.
   * @param text Text to be added to the buffer.
   * @param itemOffset The offset of the first character to add to the buffer.
   * @param itemLength The number of characters to add to the buffer, or omit for the end of text.
   */
  addText(text: string, itemOffset?: number, itemLength?: number): void;
  /**
   * Add code points to the buffer.
   * @param codePoints Array of code points to be added to the buffer.
   * @param itemOffset The offset of the first code point to add to the buffer.
   * @param itemLength The number of code points to add to the buffer, or omit for the end of the array.
   */
  addCodePoints(codePoints: number[], itemOffset?: number, itemLength?: number): void;
  /**
   * Set buffer script, language and direction.
   *
   * This needs to be done before shaping.
   */
  guessSegmentProperties(): void;
  /**
   * Set buffer direction explicitly.
   * @param dir A {@link Direction} value.
   */
  setDirection(dir: Direction): void;
  /**
   * Set buffer flags explicitly.
   * @param flags A combination of {@link BufferFlag} values (OR them together).
   */
  setFlags(flags: number): void;
  /**
   * Set buffer language explicitly.
   * @param language The buffer language
   */
  setLanguage(language: string): void;
  /**
   * Set buffer script explicitly.
   * @param script The buffer script
   */
  setScript(script: string): void;
  /**
   * Set the HarfBuzz clustering level.
   *
   * Affects the cluster values returned from shaping.
   * @param level A {@link ClusterLevel} value. See the HarfBuzz manual chapter on Clusters.
   */
  setClusterLevel(level: ClusterLevel): void;
  /** Reset the buffer to its initial status. */
  reset(): void;
  /**
   * Similar to reset(), but does not clear the Unicode functions and the
   * replacement code point.
   */
  clearContents(): void;
  /**
   * Set message func.
   * @param func The function to set. It receives the buffer, font, and message
   * string as arguments. Returning false will skip this shaping step and move
   * to the next one.
   */
  setMessageFunc(func: (buffer: Buffer, font: Font, message: string) => boolean): void;
  /**
   * Get the the number of items in the buffer.
   * @returns The buffer length.
   */
  getLength(): number;
  /**
   * Get the glyph information from the buffer.
   * @returns An array of {@link GlyphInfo} objects.
   */
  getGlyphInfos(): GlyphInfo[];
  /**
   * Get the glyph positions from the buffer.
   * @returns An array of {@link GlyphPosition} objects.
   */
  getGlyphPositions(): GlyphPosition[];
  /**
   * Get the glyph information and positions from the buffer.
   * @returns The glyph information and positions.
   *
   * The glyph information is returned as an array of objects with the
   * properties from getGlyphInfos and getGlyphPositions combined.
   */
  getGlyphInfosAndPositions(): (GlyphInfo & Partial<GlyphPosition>)[];
  /**
   * Update the glyph positions in the buffer.
   * WARNING: Do not use unless you know what you are doing.
   */
  updateGlyphPositions(positions: GlyphPosition[]): void;
  /**
   * Serialize the buffer contents to a string.
   * @param options Serialization options:
   *  - `font`: the font to use for serialization;
   *  - `start`: the starting index of the glyphs (default `0`);
   *  - `end`: the ending index of the glyphs (default end of buffer);
   *  - `format`: a {@link BufferSerializeFormat} value (default `TEXT`);
   *  - `flags`: a combination of {@link BufferSerializeFlag} values (default `0`).
   * @returns The serialized buffer contents.
   */
  serialize(options?: {
    font?: Font;
    start?: number;
    end?: number;
    format?: BufferSerializeFormat;
    flags?: number;
  }): string;
  /**
   * Return the buffer content type.
   *
   * @returns The buffer content type as a {@link BufferContentType} value.
   */
  getContentType(): BufferContentType;
}
//#endregion
//#region src/font-funcs.d.ts
/**
 * An object representing {@link https://harfbuzz.github.io/harfbuzz-hb-font.html | HarfBuzz font functions}.
 * Font functions define the methods used by a Font for lower-level queries
 * like glyph advances and extents. HarfBuzz provides built-in default
 * implementations which can be selectively overridden.
 */
declare class FontFuncs {
  dispose(): void;
  readonly ptr: number;
  constructor();
  /**
   * Set the font's glyph extents function.
   * @param func The callback receives a Font and glyph ID. It should return
   * an object with xBearing, yBearing, width, and height, or undefined on failure.
   */
  setGlyphExtentsFunc(func: (font: Font, glyph: number) => GlyphExtents | undefined): void;
  /**
   * Set the font's glyph from name function.
   * @param func The callback receives a Font and glyph name. It should return
   * the glyph ID, or undefined on failure.
   */
  setGlyphFromNameFunc(func: (font: Font, name: string) => number | undefined): void;
  /**
   * Set the font's glyph horizontal advance function.
   * @param func The callback receives a Font and glyph ID. It should return
   * the horizontal advance of the glyph.
   */
  setGlyphHAdvanceFunc(func: (font: Font, glyph: number) => number): void;
  /**
   * Set the font's glyph vertical advance function.
   * @param func The callback receives a Font and glyph ID. It should return
   * the vertical advance of the glyph.
   */
  setGlyphVAdvanceFunc(func: (font: Font, glyph: number) => number): void;
  /**
   * Set the font's glyph horizontal origin function.
   * @param func The callback receives a Font and glyph ID. It should return
   * the [x, y] horizontal origin of the glyph, or undefined on failure.
   */
  setGlyphHOriginFunc(func: (font: Font, glyph: number) => [number, number] | undefined): void;
  /**
   * Set the font's glyph vertical origin function.
   * @param func The callback receives a Font and glyph ID. It should return
   * the [x, y] vertical origin of the glyph, or undefined on failure.
   */
  setGlyphVOriginFunc(func: (font: Font, glyph: number) => [number, number] | undefined): void;
  /**
   * Set the font's glyph horizontal kerning function.
   * @param func The callback receives a Font, first glyph ID, and second glyph ID.
   * It should return the horizontal kerning of the glyphs.
   */
  setGlyphHKerningFunc(func: (font: Font, firstGlyph: number, secondGlyph: number) => number): void;
  /**
   * Set the font's glyph name function.
   * @param func The callback receives a Font and glyph ID. It should return
   * the name of the glyph, or undefined on failure.
   */
  setGlyphNameFunc(func: (font: Font, glyph: number) => string | undefined): void;
  /**
   * Set the font's nominal glyph function.
   * @param func The callback receives a Font and unicode code point. It should
   * return the nominal glyph of the unicode, or undefined on failure.
   */
  setNominalGlyphFunc(func: (font: Font, unicode: number) => number | undefined): void;
  /**
   * Set the font's variation glyph function.
   * @param func The callback receives a Font, unicode code point, and variation
   * selector. It should return the variation glyph, or undefined on failure.
   */
  setVariationGlyphFunc(func: (font: Font, unicode: number, variationSelector: number) => number | undefined): void;
  /**
   * Set the font's horizontal extents function.
   * @param func The callback receives a Font. It should return an object with
   * ascender, descender, and lineGap, or undefined on failure.
   */
  setFontHExtentsFunc(func: (font: Font) => FontExtents | undefined): void;
  /**
   * Set the font's vertical extents function.
   * @param func The callback receives a Font. It should return an object with
   * ascender, descender, and lineGap, or undefined on failure.
   */
  setFontVExtentsFunc(func: (font: Font) => FontExtents | undefined): void;
}
//#endregion
//#region src/draw-funcs.d.ts
/**
 * A callback to perform a `move-to` draw operation.
 * @param x X component of target point
 * @param y Y component of target point
 * @param drawData the data accompanying the draw functions in
 * {@link Font.drawGlyph}
 * @param userData the user data pointer passed to
 * {@link DrawFuncs.setMoveToFunc}
 */
type DrawMoveToFunc = (x: number, y: number, drawData: unknown, userData: unknown) => void;
/**
 * A callback to perform a `line-to` draw operation.
 * @param x X component of target point
 * @param y Y component of target point
 * @param drawData the data accompanying the draw functions in
 * {@link Font.drawGlyph}
 * @param userData the user data pointer passed to
 * {@link DrawFuncs.setLineToFunc}
 */
type DrawLineToFunc = (x: number, y: number, drawData: unknown, userData: unknown) => void;
/**
 * A callback to perform a `quadratic-to` draw operation.
 * @param cx X component of control point
 * @param cy Y component of control point
 * @param x X component of target point
 * @param y Y component of target point
 * @param drawData the data accompanying the draw functions in
 * {@link Font.drawGlyph}
 * @param userData the user data pointer passed to
 * {@link DrawFuncs.setQuadraticToFunc}
 */
type DrawQuadraticToFunc = (cx: number, cy: number, x: number, y: number, drawData: unknown, userData: unknown) => void;
/**
 * A callback to perform a `cubic-to` draw operation.
 * @param c1x X component of first control point
 * @param c1y Y component of first control point
 * @param c2x X component of second control point
 * @param c2y Y component of second control point
 * @param x X component of target point
 * @param y Y component of target point
 * @param drawData the data accompanying the draw functions in
 * {@link Font.drawGlyph}
 * @param userData the user data pointer passed to
 * {@link DrawFuncs.setCubicToFunc}
 */
type DrawCubicToFunc = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number, drawData: unknown, userData: unknown) => void;
/**
 * A callback to perform a `close-path` draw operation.
 * @param drawData the data accompanying the draw functions in
 * {@link Font.drawGlyph}
 * @param userData the user data pointer passed to
 * {@link DrawFuncs.setClosePathFunc}
 */
type DrawClosePathFunc = (drawData: unknown, userData: unknown) => void;
/**
 * An object representing
 * {@link https://harfbuzz.github.io/harfbuzz-hb-draw.html | HarfBuzz draw functions}.
 *
 * Glyph draw callbacks.
 *
 * The {@link DrawFuncs.setMoveToFunc | move-to},
 * {@link DrawFuncs.setLineToFunc | line-to} and
 * {@link DrawFuncs.setCubicToFunc | cubic-to} callbacks are necessary to be
 * defined, but we translate {@link DrawFuncs.setQuadraticToFunc | quadratic-to}
 * calls to cubic-to if the callback isn't defined.
 */
declare class DrawFuncs {
  readonly ptr: number;
  private funcPtrs;
  private userDataPtrs;
  constructor();
  /**
   * Sets move-to callback to the draw functions object.
   * @param func The move-to callback.
   * @param userData Data to pass to `func`.
   */
  setMoveToFunc(func: DrawMoveToFunc, userData?: unknown): void;
  /**
   * Sets line-to callback to the draw functions object.
   * @param func The line-to callback.
   * @param userData Data to pass to `func`.
   */
  setLineToFunc(func: DrawLineToFunc, userData?: unknown): void;
  /**
   * Sets quadratic-to callback to the draw functions object.
   * @param func The quadratic-to callback.
   * @param userData Data to pass to `func`.
   */
  setQuadraticToFunc(func: DrawQuadraticToFunc, userData?: unknown): void;
  /**
   * Sets cubic-to callback to the draw functions object.
   * @param func The cubic-to callback.
   * @param userData Data to pass to `func`.
   */
  setCubicToFunc(func: DrawCubicToFunc, userData?: unknown): void;
  /**
   * Sets close-path callback to the draw functions object.
   * @param func The close-path callback.
   * @param userData Data to pass to `func`.
   */
  setClosePathFunc(func: DrawClosePathFunc, userData?: unknown): void;
}
//#endregion
//#region src/paint-funcs.d.ts
/**
 * A callback to apply a transform to subsequent paint calls. The transform is
 * applied after the current transform, and remains in effect until a matching
 * call to {@link PaintFuncs.setPopTransformFunc}.
 * @param xx xx component of the transform matrix
 * @param yx yx component of the transform matrix
 * @param xy xy component of the transform matrix
 * @param yy yy component of the transform matrix
 * @param dx dx component of the transform matrix
 * @param dy dy component of the transform matrix
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setPushTransformFunc}
 */
type PaintPushTransformFunc = (xx: number, yx: number, xy: number, yy: number, dx: number, dy: number, paintData: unknown, userData: unknown) => void;
/**
 * A callback to undo the effect of a prior call to the
 * {@link PaintFuncs.setPushTransformFunc} callback.
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setPopTransformFunc}
 */
type PaintPopTransformFunc = (paintData: unknown, userData: unknown) => void;
/**
 * A callback to render a color glyph by glyph index.
 * @param glyph the glyph ID
 * @param font the {@link Font}
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setColorGlyphFunc}
 * @returns `true` if the glyph was painted, `false` otherwise.
 */
type PaintColorGlyphFunc = (glyph: number, font: Font, paintData: unknown, userData: unknown) => boolean;
/**
 * A callback to clip subsequent paint calls to the outline of a glyph.
 *
 * The coordinates of the glyph outline are expected in the current `font` scale
 * (ie. the results of calling {@link Font.drawGlyph} with `font`). The outline
 * is transformed by the current transform.
 *
 * This clip is applied in addition to the current clip, and remains in effect
 * until a matching call to {@link PaintFuncs.setPopClipFunc}.
 * @param glyph the glyph ID
 * @param font the {@link Font}
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setPushClipGlyphFunc}
 */
type PaintPushClipGlyphFunc = (glyph: number, font: Font, paintData: unknown, userData: unknown) => void;
/**
 * A callback to clip subsequent paint calls to a rectangle.
 *
 * The coordinates of the rectangle are interpreted according to the current
 * transform.
 *
 * This clip is applied in addition to the current clip, and remains in effect
 * until a matching call to {@link PaintFuncs.setPopClipFunc}.
 * @param xmin min X for the rectangle
 * @param ymin min Y for the rectangle
 * @param xmax max X for the rectangle
 * @param ymax max Y for the rectangle
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setPushClipRectangleFunc}
 */
type PaintPushClipRectangleFunc = (xmin: number, ymin: number, xmax: number, ymax: number, paintData: unknown, userData: unknown) => void;
/**
 * A callback to undo the effect of a prior call to the
 * {@link PaintFuncs.setPushClipGlyphFunc} or
 * {@link PaintFuncs.setPushClipRectangleFunc} callback.
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setPopClipFunc}
 */
type PaintPopClipFunc = (paintData: unknown, userData: unknown) => void;
/**
 * A callback to paint a color everywhere within the current clip.
 *
 * When `isForeground` is true, this color originates from the foreground-color
 * sentinel in the font's color data. The `color` parameter still carries a
 * fully resolved RGBA value (with any paint-tree alpha already applied), so
 * backends that do not need to distinguish the foreground can simply use
 * `color` directly.
 *
 * Backends that defer foreground resolution (e.g. to honor a CSS `currentColor`
 * or a runtime uniform) should substitute their own foreground RGB when
 * `isForeground` is true, but must combine the alpha from `color` with their
 * foreground alpha, since it encodes additional modulation from the paint tree.
 * For this mode to work correctly, the caller should pass a fully-opaque
 * foreground color to {@link Font.paintGlyph}, so that the alpha in `color`
 * reflects only the paint-tree contribution.
 * @param isForeground whether the color is the foreground
 * @param color the color to use, unpremultiplied
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setColorFunc}
 */
type PaintColorFunc = (isForeground: boolean, color: Color, paintData: unknown, userData: unknown) => void;
/**
 * A callback to paint a glyph image.
 *
 * This method is called for glyphs with image blobs in the CBDT, sbix or SVG
 * tables. The `format` identifies the kind of data that is contained in
 * `image`. Possible values include `"png "`, `"svg "` and `"BGRA"`.
 *
 * The image dimensions and glyph extents are provided if available, and should
 * be used to size and position the image.
 * @param image the image data
 * @param width width of the raster image in pixels, or 0
 * @param height height of the raster image in pixels, or 0
 * @param format the image format as a tag
 * @param extents glyph extents for desired rendering
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setImageFunc}
 * @returns Whether the operation was successful.
 */
type PaintImageFunc = (image: Uint8Array, width: number, height: number, format: string, extents: GlyphExtents | undefined, paintData: unknown, userData: unknown) => boolean;
/**
 * A callback to paint a linear gradient everywhere within the current clip. The
 * coordinates of the points are interpreted according to the current transform; see the
 * OpenType spec
 * [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr)
 * section for details on how the points define the direction of the gradient, and
how to interpret the `colorLine`.
 * @param colorLine color information for the gradient
 * @param x0 X coordinate of the first point
 * @param y0 Y coordinate of the first point
 * @param x1 X coordinate of the second point
 * @param y1 Y coordinate of the second point
 * @param x2 X coordinate of the third point
 * @param y2 Y coordinate of the third point
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setLinearGradientFunc}
 */
type PaintLinearGradientFunc = (colorLine: ColorLine, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, paintData: unknown, userData: unknown) => void;
/**
 * A callback to paint a radial gradient everywhere within the current clip. The
 * coordinates of the points are interpreted according to the current transform; see the
 * OpenType spec
 * [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr)
 * section for details on how the points define the direction of the gradient, and
how to interpret the `colorLine`.
 * @param colorLine color information for the gradient
 * @param x0 X coordinate of the first circle's center
 * @param y0 Y coordinate of the first circle's center
 * @param r0 radius of the first circle
 * @param x1 X coordinate of the second circle's center
 * @param y1 Y coordinate of the second circle's center
 * @param r1 radius of the second circle
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setRadialGradientFunc}
 */
type PaintRadialGradientFunc = (colorLine: ColorLine, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, paintData: unknown, userData: unknown) => void;
/**
 * A callback to paint a sweep gradient everywhere within the current clip. The
 * coordinates of the points are interpreted according to the current transform; see the
 * OpenType spec
 * [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr)
 * section for details on how the points define the direction of the gradient, and
how to interpret the `colorLine`.
 * @param colorLine color information for the gradient
 * @param x0 X coordinate of the circle's center
 * @param y0 Y coordinate of the circle's center
 * @param startAngle the start angle, in radians
 * @param endAngle the end angle, in radians
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setSweepGradientFunc}
 */
type PaintSweepGradientFunc = (colorLine: ColorLine, x0: number, y0: number, startAngle: number, endAngle: number, paintData: unknown, userData: unknown) => void;
/**
 * A callback to use an intermediate surface for subsequent paint calls. The
 * drawing is redirected to the intermediate surface until a matching call to
 * {@link PaintFuncs.setPopGroupFunc}.
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setPushGroupFunc}
 */
type PaintPushGroupFunc = (paintData: unknown, userData: unknown) => void;
/**
 * A callback to undo the effect of a prior call to the
 * {@link PaintFuncs.setPushGroupFunc} callback: it stops the redirection to the
 * intermediate surface, then composites it on the previous surface using the
 * compositing mode passed to this call.
 * @param mode the {@link PaintCompositeMode} to use
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setPopGroupFunc}
 */
type PaintPopGroupFunc = (mode: PaintCompositeMode, paintData: unknown, userData: unknown) => void;
/**
 * A callback to fetch a custom palette override color for `colorIndex`.
 *
 * Custom palette colors override colors from the font's selected color palette.
 * It is not necessary to override all palette entries; return `undefined` for
 * entries that should be taken from the font palette.
 *
 * This function might be called multiple times, but the custom palette is
 * expected to remain unchanged for the duration of one {@link Font.paintGlyph}
 * call.
 * @param colorIndex color index to fetch
 * @param paintData the data accompanying the paint functions in
 * {@link Font.paintGlyph}
 * @param userData the user data pointer passed to
 * {@link PaintFuncs.setCustomPaletteColorFunc}
 * @returns the custom color, or `undefined` to use the font palette.
 */
type PaintCustomPaletteColorFunc = (colorIndex: number, paintData: unknown, userData: unknown) => Color | undefined;
/**
 * An object representing
 * {@link https://harfbuzz.github.io/harfbuzz-hb-paint.html | HarfBuzz paint functions}.
 *
 * Glyph paint callbacks.
 *
 * The callbacks assume that the caller maintains a stack of current transforms,
 * clips and intermediate surfaces, as evidenced by the pairs of push/pop
 * callbacks. The push/pop calls will be properly nested, so it is fine to store
 * the different kinds of object on a single stack.
 *
 * Not all callbacks are required for all kinds of glyphs. For rendering COLRv0
 * or non-color outline glyphs, the gradient callbacks are not needed, and the
 * composite callback only needs to handle simple alpha compositing
 * ({@link PaintCompositeMode.SRC_OVER}).
 *
 * The paint-image callback is only needed for glyphs with image blobs in the
 * CBDT, sbix or SVG tables.
 *
 * The custom-palette-color callback is only necessary if you want to override
 * colors from the font palette with custom colors.
 */
declare class PaintFuncs {
  readonly ptr: number;
  private funcPtrs;
  private userDataPtrs;
  constructor();
  /**
   * Sets the push-transform callback on the paint functions object.
   * @param func The push-transform callback.
   * @param userData Data to pass to `func`.
   */
  setPushTransformFunc(func: PaintPushTransformFunc, userData?: unknown): void;
  /**
   * Sets the pop-transform callback on the paint functions object.
   * @param func The pop-transform callback.
   * @param userData Data to pass to `func`.
   */
  setPopTransformFunc(func: PaintPopTransformFunc, userData?: unknown): void;
  /**
   * Sets the color-glyph callback on the paint functions object.
   * @param func The color-glyph callback.
   * @param userData Data to pass to `func`.
   */
  setColorGlyphFunc(func: PaintColorGlyphFunc, userData?: unknown): void;
  /**
   * Sets the push-clip-glyph callback on the paint functions object.
   * @param func The push-clip-glyph callback.
   * @param userData Data to pass to `func`.
   */
  setPushClipGlyphFunc(func: PaintPushClipGlyphFunc, userData?: unknown): void;
  /**
   * Sets the push-clip-rectangle callback on the paint functions object.
   * @param func The push-clip-rectangle callback.
   * @param userData Data to pass to `func`.
   */
  setPushClipRectangleFunc(func: PaintPushClipRectangleFunc, userData?: unknown): void;
  /**
   * Sets the pop-clip callback on the paint functions object.
   * @param func The pop-clip callback.
   * @param userData Data to pass to `func`.
   */
  setPopClipFunc(func: PaintPopClipFunc, userData?: unknown): void;
  /**
   * Sets the paint-color callback on the paint functions object.
   * @param func The paint-color callback.
   * @param userData Data to pass to `func`.
   */
  setColorFunc(func: PaintColorFunc, userData?: unknown): void;
  /**
   * Sets the paint-image callback on the paint functions object.
   * @param func The paint-image callback.
   * @param userData Data to pass to `func`.
   */
  setImageFunc(func: PaintImageFunc, userData?: unknown): void;
  /**
   * Sets the linear-gradient callback on the paint functions object.
   * @param func The linear-gradient callback.
   * @param userData Data to pass to `func`.
   */
  setLinearGradientFunc(func: PaintLinearGradientFunc, userData?: unknown): void;
  /**
   * Sets the radial-gradient callback on the paint functions object.
   * @param func The radial-gradient callback.
   * @param userData Data to pass to `func`.
   */
  setRadialGradientFunc(func: PaintRadialGradientFunc, userData?: unknown): void;
  /**
   * Sets the sweep-gradient callback on the paint functions object.
   * @param func The sweep-gradient callback.
   * @param userData Data to pass to `func`.
   */
  setSweepGradientFunc(func: PaintSweepGradientFunc, userData?: unknown): void;
  /**
   * Sets the push-group callback on the paint functions object.
   * @param func The push-group callback.
   * @param userData Data to pass to `func`.
   */
  setPushGroupFunc(func: PaintPushGroupFunc, userData?: unknown): void;
  /**
   * Sets the pop-group callback on the paint functions object.
   * @param func The pop-group callback.
   * @param userData Data to pass to `func`.
   */
  setPopGroupFunc(func: PaintPopGroupFunc, userData?: unknown): void;
  /**
   * Sets the custom-palette-color callback on the paint functions object.
   * @param func The custom-palette-color callback.
   * @param userData Data to pass to `func`.
   */
  setCustomPaletteColorFunc(func: PaintCustomPaletteColorFunc, userData?: unknown): void;
}
//#endregion
//#region src/variation.d.ts
/**
 * A {@link https://harfbuzz.github.io/harfbuzz-hb-common.html#hb-variation-t | HarfBuzz variation}.
 *
 * Data type for holding variation data. Registered OpenType variation-axis
 * tags are listed in
 * {@link https://docs.microsoft.com/en-us/typography/opentype/spec/dvaraxisreg | OpenType Axis Tag Registry}.
 */
declare class Variation {
  /** The tag of the variation-axis name. */
  tag: string;
  /** The value of the variation axis. */
  value: number;
  constructor(tag: string, value?: number);
  /**
   * Parses a string into a Variation.
   *
   * The format for specifying variation settings follows. All valid CSS
   * font-variation-settings values other than `normal` and `inherited` are
   * also accepted, though, not documented below.
   *
   * The format is a tag, optionally followed by an equals sign, followed by a
   * number. For example `wght=500`, or `slnt=-7.5`.
   *
   * @param str The string to parse.
   * @returns A Variation, or undefined if the string is not a valid variation.
   */
  static fromString(str: string): Variation | undefined;
  /**
   * Converts the variation to a string in the format understood by
   * {@link Variation.fromString}.
   *
   * Note that the string won't include any whitespace.
   *
   * @returns The variation string.
   */
  toString(): string;
  /** @internal Write this variation into the given hb_variation_t pointer. */
  writeTo(ptr: number): void;
}
//#endregion
//#region src/font.d.ts
/**
 * Metric tags corresponding to [MVAR Value
 * Tags](https://docs.microsoft.com/en-us/typography/opentype/spec/mvar#value-tags).
 */
declare const MetricsTag: {
  /** horizontal ascender. */readonly HORIZONTAL_ASCENDER: number; /** horizontal descender. */
  readonly HORIZONTAL_DESCENDER: number; /** horizontal line gap. */
  readonly HORIZONTAL_LINE_GAP: number; /** horizontal clipping ascent. */
  readonly HORIZONTAL_CLIPPING_ASCENT: number; /** horizontal clipping descent. */
  readonly HORIZONTAL_CLIPPING_DESCENT: number; /** vertical ascender. */
  readonly VERTICAL_ASCENDER: number; /** vertical descender. */
  readonly VERTICAL_DESCENDER: number; /** vertical line gap. */
  readonly VERTICAL_LINE_GAP: number; /** horizontal caret rise. */
  readonly HORIZONTAL_CARET_RISE: number; /** horizontal caret run. */
  readonly HORIZONTAL_CARET_RUN: number; /** horizontal caret offset. */
  readonly HORIZONTAL_CARET_OFFSET: number; /** vertical caret rise. */
  readonly VERTICAL_CARET_RISE: number; /** vertical caret run. */
  readonly VERTICAL_CARET_RUN: number; /** vertical caret offset. */
  readonly VERTICAL_CARET_OFFSET: number; /** x height. */
  readonly X_HEIGHT: number; /** cap height. */
  readonly CAP_HEIGHT: number; /** subscript em x size. */
  readonly SUBSCRIPT_EM_X_SIZE: number; /** subscript em y size. */
  readonly SUBSCRIPT_EM_Y_SIZE: number; /** subscript em x offset. */
  readonly SUBSCRIPT_EM_X_OFFSET: number; /** subscript em y offset. */
  readonly SUBSCRIPT_EM_Y_OFFSET: number; /** superscript em x size. */
  readonly SUPERSCRIPT_EM_X_SIZE: number; /** superscript em y size. */
  readonly SUPERSCRIPT_EM_Y_SIZE: number; /** superscript em x offset. */
  readonly SUPERSCRIPT_EM_X_OFFSET: number; /** superscript em y offset. */
  readonly SUPERSCRIPT_EM_Y_OFFSET: number; /** strikeout size. */
  readonly STRIKEOUT_SIZE: number; /** strikeout offset. */
  readonly STRIKEOUT_OFFSET: number; /** underline size. */
  readonly UNDERLINE_SIZE: number; /** underline offset. */
  readonly UNDERLINE_OFFSET: number;
};
type MetricsTag = ValueOf<typeof MetricsTag>;
/**
 * An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-font.html | HarfBuzz font}.
 * A font represents a face at a specific size and with certain other
 * parameters (pixels-per-em, variation settings) specified. Fonts are the
 * primary input to the shaping process.
 */
declare class Font {
  dispose(): void;
  readonly ptr: number;
  private _face?;
  /**
   * @param face A Face to create the font from.
   */
  constructor(face: Face);
  /** @internal Wrap an existing font pointer. */
  constructor(existingPtr: number);
  /** The {@link Face} associated with this font. */
  get face(): Face;
  /**
   * Create a sub font that inherits this font's properties.
   * @returns A new Font object representing the sub font.
   */
  subFont(): Font;
  /**
   * Return font horizontal extents.
   * @returns Object with ascender, descender, and lineGap properties.
   */
  hExtents(): FontExtents;
  /**
   * Return font vertical extents.
   * @returns Object with ascender, descender, and lineGap properties.
   */
  vExtents(): FontExtents;
  /**
   * Return glyph name.
   * @param glyphId ID of the requested glyph in the font.
   * @returns The glyph name string.
   */
  glyphName(glyphId: number): string;
  /**
   * Draws the outline that corresponds to a glyph in the specified font.
   *
   * The outline is returned by way of calls to the callbacks of the `drawFuncs`
   * object, with `drawData` passed to them.
   * @param glyphId The glyph ID.
   * @param drawFuncs The {@link DrawFuncs} to draw to.
   * @param drawData User data to pass to draw callbacks.
   */
  drawGlyph(glyphId: number, drawFuncs: DrawFuncs, drawData?: unknown): void;
  /**
   * Draws the outline that corresponds to a glyph in the specified font.
   *
   * This is a newer name for {@link Font.drawGlyph}, that returns `false` if the
   * font has no outlines for the glyph.
   *
   * The outline is returned by way of calls to the callbacks of the `drawFuncs`
   * object, with `drawData` passed to them.
   * @param glyphId The glyph ID.
   * @param drawFuncs The {@link DrawFuncs} to draw to.
   * @param drawData User data to pass to draw callbacks.
   * @returns `true` if the glyph was drawn, `false` otherwise.
   */
  drawGlyphOrFail(glyphId: number, drawFuncs: DrawFuncs, drawData?: unknown): boolean;
  /**
   * Paints the glyph. This function is similar to {@link Font.paintGlyphOrFail},
   * but if painting a color glyph failed, it will fall back to painting an
   * outline monochrome glyph.
   *
   * The painting instructions are returned by way of calls to the callbacks of
   * the `paintFuncs` object, with `paintData` passed to them.
   *
   * If the font has color palettes, then `paletteIndex` selects the palette to
   * use. If the font only has one palette, this will be 0.
   * @param glyphId The glyph ID.
   * @param paintFuncs The {@link PaintFuncs} to paint with.
   * @param paintData User data to pass to paint callbacks.
   * @param paletteIndex The index of the font's color palette to use.
   * @param foreground The foreground color, unpremultiplied.
   */
  paintGlyph(glyphId: number, paintFuncs: PaintFuncs, paintData?: unknown, paletteIndex?: number, foreground?: Color): void;
  /**
   * Paints a color glyph.
   *
   * Succeeds if the glyph has color paint layers (COLRv0), a color paint graph
   * (COLRv1), or a bitmap image that the font's callbacks render successfully.
   * Returns `false` if the font has no color data for the glyph; the client can
   * then fall back to {@link Font.drawGlyphOrFail} for the monochrome outline.
   *
   * The painting instructions are returned by way of calls to the callbacks of
   * the `paintFuncs` object, with `paintData` passed to them.
   *
   * If the font has color palettes, then `paletteIndex` selects the palette to
   * use. If the font only has one palette, this will be 0.
   * @param glyphId The glyph ID.
   * @param paintFuncs The {@link PaintFuncs} to paint with.
   * @param paintData User data to pass to paint callbacks.
   * @param paletteIndex The index of the font's color palette to use.
   * @param foreground The foreground color, unpremultiplied.
   * @returns `true` if the glyph was painted, `false` otherwise.
   */
  paintGlyphOrFail(glyphId: number, paintFuncs: PaintFuncs, paintData?: unknown, paletteIndex?: number, foreground?: Color): boolean;
  /**
   * Fetches the PNG image for a glyph.
   *
   * To get an optimally sized PNG blob, the PPEM values must be set on the font.
   * If PPEM is unset, the blob returned will be the largest PNG available.
   * @param glyphId A glyph index.
   * @returns The PNG image for the glyph, or `undefined` if the glyph has no PNG
   * image.
   */
  getGlyphColorPng(glyphId: number): Uint8Array | undefined;
  /**
   * Return a glyph as an SVG path string.
   * @param glyphId ID of the requested glyph in the font.
   * @returns SVG path data string.
   */
  glyphToPath(glyphId: number): string;
  /**
   * Return glyph horizontal advance.
   * @param glyphId ID of the requested glyph in the font.
   * @returns The horizontal advance width.
   */
  glyphHAdvance(glyphId: number): number;
  /**
   * Return glyph vertical advance.
   * @param glyphId ID of the requested glyph in the font.
   * @returns The vertical advance height.
   */
  glyphVAdvance(glyphId: number): number;
  /**
   * Return glyph horizontal origin.
   * @param glyphId ID of the requested glyph in the font.
   * @returns [x, y] origin coordinates, or undefined if not available.
   */
  glyphHOrigin(glyphId: number): [number, number] | undefined;
  /**
   * Return glyph vertical origin.
   * @param glyphId ID of the requested glyph in the font.
   * @returns [x, y] origin coordinates, or undefined if not available.
   */
  glyphVOrigin(glyphId: number): [number, number] | undefined;
  /**
   * Return glyph extents.
   * @param glyphId ID of the requested glyph in the font.
   * @returns An object with xBearing, yBearing, width, and height, or undefined.
   */
  glyphExtents(glyphId: number): GlyphExtents | undefined;
  /**
   * Fetches the glyph ID for a Unicode code point in the specified
   * font, with an optional variation selector.
   *
   * If `variationSelector` is 0, it is equivalent to
   * {@link Font.nominalGlyph}; otherwise it is equivalent to
   * {@link Font.variationGlyph}.
   *
   * @param unicode The Unicode code point to query.
   * @param variationSelector A variation-selector code point.
   * @returns The glyph ID, or undefined if not found.
   */
  glyph(unicode: number, variationSelector?: number): number | undefined;
  /**
   * Fetches the nominal glyph ID for a Unicode code point in the
   * specified font.
   *
   * This version of the function should not be used to fetch glyph IDs
   * for code points modified by variation selectors. For variation-selector
   * support, use {@link Font.variationGlyph} or {@link Font.glyph}.
   *
   * @param unicode The Unicode code point to query.
   * @returns The glyph ID, or undefined if not found.
   */
  nominalGlyph(unicode: number): number | undefined;
  /**
   * Fetches the glyph ID for a Unicode code point when followed by
   * by the specified variation-selector code point, in the specified
   * font.
   *
   * @param unicode The Unicode code point to query.
   * @param variationSelector The variation-selector code point to query.
   * @returns The glyph ID, or undefined if not found.
   */
  variationGlyph(unicode: number, variationSelector: number): number | undefined;
  /**
   * Return glyph ID from name.
   * @param name Name of the requested glyph in the font.
   * @returns The glyph ID, or undefined if not found.
   */
  glyphFromName(name: string): number | undefined;
  /**
   * Return a glyph as a JSON path string
   * based on format described on https://svgwg.org/specs/paths/#InterfaceSVGPathSegment
   * @param glyphId ID of the requested glyph in the font.
   * @returns An array of path segment objects with type and values.
   */
  glyphToJson(glyphId: number): SvgPathCommand[];
  /**
   * Set the font's scale factor, affecting the position values returned from
   * shaping.
   * @param xScale Units to scale in the X dimension.
   * @param yScale Units to scale in the Y dimension.
   */
  setScale(xScale: number, yScale: number): void;
  /**
   * Applies a list of font-variation settings to a font.
   *
   * Note that this overrides all existing variations set on the font.
   * Axes not included in `variations` will be effectively set to their
   * default values.
   *
   * @param variations Array of variation settings to apply.
   */
  setVariations(variations: Variation[]): void;
  /** Set the font's font functions. */
  setFuncs(fontFuncs: FontFuncs): void;
  /**
   * Fetches the optical bound of a glyph positioned at the margin of text.
   * The direction identifies which edge of the glyph to query.
   * @param lookupIndex Index of the feature lookup to query.
   * @param direction Edge of the glyph to query.
   * @param glyph A glyph id.
   * @returns Adjustment value. Negative values mean the glyph will stick out of the margin.
   */
  getLookupOpticalBound(lookupIndex: number, direction: Direction, glyph: number): number;
  /**
   * Fetches a list of the caret positions defined for a ligature glyph in the
   * GDEF table of the font.
   *
   * Note that a ligature that is formed from n characters will have n-1
   * caret positions. The first character is not represented in the array,
   * since its caret position is the glyph position.
   *
   * The positions returned by this function are 'unshaped', and will have to
   * be fixed up for kerning that may be applied to the ligature glyph.
   *
   * @param direction The text direction to use.
   * @param glyph The glyph to query.
   * @returns An array of caret positions.
   */
  getLigatureCarets(direction: Direction, glyph: number): number[];
  /**
   * Fetches metrics value corresponding to `metricsTag` from the font.
   *
   * @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
   * @returns The metrics value, or undefined if not found in the font.
   */
  getMetricPosition(metricsTag: MetricsTag): number | undefined;
  /**
   * Fetches metrics value corresponding to `metricsTag` from the font, and
   * synthesizes a value if the value is missing in the font.
   *
   * @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
   * @returns The metrics value.
   */
  getMetricPositionWithFallback(metricsTag: MetricsTag): number;
  /**
   * Fetches metrics value corresponding to `metricsTag` from the font with the
   * current font variation settings applied.
   *
   * @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
   * @returns The requested metric value.
   */
  getMetricVariation(metricsTag: MetricsTag): number;
  /**
   * Fetches horizontal metrics value corresponding to `metricsTag` from the
   * font with the current font variation settings applied.
   *
   * @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
   * @returns The requested metric value.
   */
  getMetricXVariation(metricsTag: MetricsTag): number;
  /**
   * Fetches vertical metrics value corresponding to `metricsTag` from the font
   * with the current font variation settings applied.
   *
   * @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
   * @returns The requested metric value.
   */
  getMetricYVariation(metricsTag: MetricsTag): number;
}
//#endregion
//#region src/feature.d.ts
/**
 * A {@link https://harfbuzz.github.io/harfbuzz-hb-common.html#hb-feature-t | HarfBuzz feature}.
 *
 * The structure that holds information about requested feature application.
 * The feature will be applied with the given value to all glyphs which are in
 * clusters between {@link Feature.start} (inclusive) and {@link Feature.end}
 * (exclusive). Setting `start` to `0` and `end` to `0xffffffff` specifies that
 * the feature always applies to the entire buffer.
 */
declare class Feature {
  /**
   * Special setting for {@link Feature.start} to apply the feature from the
   * start of the buffer.
   */
  static readonly GLOBAL_START = 0;
  /**
   * Special setting for {@link Feature.end} to apply the feature from to the
   * end of the buffer.
   */
  static readonly GLOBAL_END = 4294967295;
  /** The tag of the feature. */
  tag: string;
  /**
   * The value of the feature. `0` disables the feature, non-zero (usually `1`)
   * enables the feature. For features implemented as lookup type 3 (like
   * `salt`) the value is a one-based index into the alternates.
   */
  value: number;
  /** The cluster to start applying this feature setting (inclusive). */
  start: number;
  /** The cluster to end applying this feature setting (exclusive). */
  end: number;
  constructor(tag: string, value?: number, start?: number, end?: number);
  /**
   * Parses a string into a Feature.
   *
   * The format for specifying feature strings follows. All valid CSS
   * font-feature-settings values other than `normal` and the global values are
   * also accepted, though not documented below. CSS string escapes are not
   * supported.
   *
   * The range indices refer to the positions between Unicode characters. The
   * position before the first character is always 0.
   *
   * The format is Python-esque. Here is how it all works:
   *
   * | Syntax        | Value | Start | End | Meaning                          |
   * | ------------- | ----- | ----- | --- | -------------------------------- |
   * | `kern`        | 1     | 0     | ∞   | Turn feature on                  |
   * | `+kern`       | 1     | 0     | ∞   | Turn feature on                  |
   * | `-kern`       | 0     | 0     | ∞   | Turn feature off                 |
   * | `kern=0`      | 0     | 0     | ∞   | Turn feature off                 |
   * | `kern=1`      | 1     | 0     | ∞   | Turn feature on                  |
   * | `aalt=2`      | 2     | 0     | ∞   | Choose 2nd alternate             |
   * | `kern[]`      | 1     | 0     | ∞   | Turn feature on                  |
   * | `kern[:]`     | 1     | 0     | ∞   | Turn feature on                  |
   * | `kern[5:]`    | 1     | 5     | ∞   | Turn feature on, partial         |
   * | `kern[:5]`    | 1     | 0     | 5   | Turn feature on, partial         |
   * | `kern[3:5]`   | 1     | 3     | 5   | Turn feature on, range           |
   * | `kern[3]`     | 1     | 3     | 3+1 | Turn feature on, single char     |
   * | `aalt[3:5]=2` | 2     | 3     | 5   | Turn 2nd alternate on for range  |
   *
   * @param str The string to parse.
   * @returns A Feature, or undefined if the string is not a valid feature.
   */
  static fromString(str: string): Feature | undefined;
  /**
   * Converts the feature to a string in the format understood by
   * {@link Feature.fromString}.
   *
   * Note that the feature value will be omitted if it is `1`, but the string
   * won't include any whitespace.
   *
   * @returns The feature string.
   */
  toString(): string;
  /** @internal Write this feature into the given hb_feature_t pointer. */
  writeTo(ptr: number): void;
}
//#endregion
//#region src/shape.d.ts
declare const TracePhase: {
  readonly DONT_STOP: 0;
  readonly GSUB: 1;
  readonly GPOS: 2;
};
type TracePhase = ValueOf<typeof TracePhase>;
/**
 * Shape a buffer with a given font.
 *
 * Converts the Unicode text in the buffer into positioned glyphs.
 * The buffer is modified in place.
 *
 * @param font The Font to shape with.
 * @param buffer The Buffer containing text to shape, suitably prepared
 *   (text added, segment properties set).
 * @param features An array of {@link Feature} values to apply.
 */
declare function shape(font: Font, buffer: Buffer, features?: Feature[]): void;
/**
 * Shape a buffer with a given font, returning a JSON trace of the shaping process.
 *
 * This function supports "partial shaping", where the shaping process is
 * terminated after a given lookup ID is reached.
 *
 * @param font The Font to shape with.
 * @param buffer The Buffer containing text to shape, suitably prepared.
 * @param features An array of {@link Feature} values to apply.
 * @param stop_at A lookup ID at which to terminate shaping.
 * @param stop_phase The {@link TracePhase} at which to stop shaping.
 * @returns An array of trace entries, each with a message, serialized glyphs, and phase info.
 */
declare function shapeWithTrace(font: Font, buffer: Buffer, features: Feature[], stop_at: number, stop_phase: TracePhase): TraceEntry[];
/**
 * Return the HarfBuzz version.
 * @returns An object with major, minor, and micro version numbers.
 */
declare function version(): {
  major: number;
  minor: number;
  micro: number;
};
/**
 * Return the HarfBuzz version as a string.
 * @returns A version string in the form "major.minor.micro".
 */
declare function versionString(): string;
/**
 * Convert an OpenType script tag to HarfBuzz script (ISO 15924).
 * @param tag The tag to convert.
 * @returns The script.
 */
declare function otTagToScript(tag: string): string;
/**
 * Convert an OpenType language tag to HarfBuzz language (BCP 47).
 * @param tag The tag to convert.
 * @returns The language.
 */
declare function otTagToLanguage(tag: string): string;
/**
 * Convert a HarfBuzz script (ISO 15924) and a HarfBuzz language (BCP 47) to OpenType script tags and OpenType language tags.
 * @param script A HarfBuzz script to convert.
 * @param language A HarfBuzz language to convert.
 * @returns An object with the OpenType script tags and the OpenType language tags.
 */
declare function otTagsFromScriptAndLanguage(script: string, language: string): {
  scriptTags: string[];
  languageTags: string[];
};
/**
 * Convert an OpenType script tag and an OpenType language tag to a HarfBuzz script (ISO 15924) and a HarfBuzz language (BCP 47).
 * @param scriptTag An OpenType script tag.
 * @param languageTag An OpenType language tag.
 * @returns An object with the HarfBuzz script and the HarfBuzz language.
 */
declare function otTagsToScriptAndLanguage(scriptTag: string, languageTag: string): {
  script: string | undefined;
  language: string | undefined;
};
//#endregion
export { AxisFlags, AxisInfo, Blob, Buffer, BufferContentType, BufferFlag, BufferSerializeFlag, BufferSerializeFormat, ClusterLevel, Color, ColorLayer, ColorLine, ColorPalette, ColorPaletteFlags, ColorStop, Direction, DrawClosePathFunc, DrawCubicToFunc, DrawFuncs, DrawLineToFunc, DrawMoveToFunc, DrawQuadraticToFunc, Face, Feature, FeatureNameIds, Font, FontExtents, FontFuncs, GlyphClass, GlyphExtents, GlyphFlag, GlyphInfo, GlyphPosition, HarfBuzzModule, MetricsTag, NameEntry, PaintColorFunc, PaintColorGlyphFunc, PaintCompositeMode, PaintCustomPaletteColorFunc, PaintExtend, PaintFuncs, PaintImageFunc, PaintLinearGradientFunc, PaintPopClipFunc, PaintPopGroupFunc, PaintPopTransformFunc, PaintPushClipGlyphFunc, PaintPushClipRectangleFunc, PaintPushGroupFunc, PaintPushTransformFunc, PaintRadialGradientFunc, PaintSweepGradientFunc, PaletteColor, SvgPathCommand, TraceEntry, TracePhase, Variation, otTagToLanguage, otTagToScript, otTagsFromScriptAndLanguage, otTagsToScriptAndLanguage, shape, shapeWithTrace, version, versionString };