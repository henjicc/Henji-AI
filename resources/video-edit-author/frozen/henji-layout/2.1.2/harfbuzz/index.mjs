import createHarfBuzz from "./harfbuzz.mjs";
//#region src/helpers.ts
let Module;
let exports;
let freeFuncPtr;
const utf8Decoder = new TextDecoder("utf8");
const utf8Encoder = new TextEncoder();
const registry = new FinalizationRegistry((cleanup) => {
	cleanup();
});
function track(obj, destroy) {
 const ptr = obj.ptr;
 let disposed = false;
 const token = {};
 registry.register(obj, () => destroy(ptr), token);
 Object.defineProperty(obj, "ptr", { get() {
  if (disposed) throw new Error("HarfBuzz object disposed");
  return ptr;
 } });
 Object.defineProperty(obj, "dispose", { value() {
  if (disposed) return;
  disposed = true;
  registry.unregister(token);
  destroy(ptr);
 } });
}
/**
* Initialize the HarfBuzz module.
* @param module The Emscripten module instance created with {@link
* createHarfBuzz}.
*/
function init(module) {
	Module = module;
	exports = Module.wasmExports;
	freeFuncPtr = Module.addFunction((ptr) => {
		exports.free(ptr);
	}, "vi");
}
function hb_tag(s) {
	return (s.charCodeAt(0) & 255) << 24 | (s.charCodeAt(1) & 255) << 16 | (s.charCodeAt(2) & 255) << 8 | (s.charCodeAt(3) & 255) << 0;
}
function hb_untag(tag) {
	return String.fromCharCode(tag >> 24 & 255, tag >> 16 & 255, tag >> 8 & 255, tag >> 0 & 255);
}
function utf8_ptr_to_string(ptr, length) {
	let end;
	if (length == void 0) end = Module.HEAPU8.indexOf(0, ptr);
	else end = ptr + length;
	return utf8Decoder.decode(Module.HEAPU8.subarray(ptr, end));
}
function utf16_ptr_to_string(ptr, length) {
	const end = ptr / 2 + length;
	return String.fromCharCode(...Module.HEAPU16.subarray(ptr / 2, end));
}
/**
* Use when you know the input range should be ASCII.
* Faster than encoding to UTF-8
*/
function string_to_ascii_ptr(text) {
	const ptr = exports.malloc(text.length + 1);
	for (let i = 0; i < text.length; ++i) {
		const char = text.charCodeAt(i);
		if (char > 127) throw new Error("Expected ASCII text");
		Module.HEAPU8[ptr + i] = char;
	}
	Module.HEAPU8[ptr + text.length] = 0;
	return {
		ptr,
		length: text.length,
		free: function() {
			exports.free(ptr);
		}
	};
}
function string_to_utf8_ptr(text) {
	const ptr = exports.malloc(text.length);
	utf8Encoder.encodeInto(text, Module.HEAPU8.subarray(ptr, ptr + text.length));
	return {
		ptr,
		length: text.length,
		free: function() {
			exports.free(ptr);
		}
	};
}
function string_to_utf16_ptr(text) {
	const ptr = exports.malloc(text.length * 2);
	const words = Module.HEAPU16.subarray(ptr / 2, ptr / 2 + text.length);
	for (let i = 0; i < words.length; ++i) words[i] = text.charCodeAt(i);
	return {
		ptr,
		length: words.length,
		free: function() {
			exports.free(ptr);
		}
	};
}
function language_to_string(language) {
	return utf8_ptr_to_string(exports.hb_language_to_string(language));
}
function language_from_string(str) {
	const languageStr = string_to_ascii_ptr(str);
	const languagePtr = exports.hb_language_from_string(languageStr.ptr, -1);
	languageStr.free();
	return languagePtr;
}
/**
* Return the typed array of HarfBuzz set contents.
* @param setPtr Pointer of set
* @returns Typed array instance
*/
function typed_array_from_set(setPtr) {
	const setCount = exports.hb_set_get_population(setPtr);
	const arrayPtr = exports.malloc(setCount << 2);
	const arrayOffset = arrayPtr >> 2;
	exports.hb_set_next_many(setPtr, -1, arrayPtr, setCount);
	return Module.HEAPU32.subarray(arrayOffset, arrayOffset + setCount);
}
const callbackData = [void 0];
const freeCallbackData = [];
function register_callback_data_pointer(data) {
	if (data === void 0) return 0;
	const dataPtr = freeCallbackData.pop() ?? callbackData.length;
	callbackData[dataPtr] = data;
	return dataPtr;
}
function get_callback_data(dataPtr) {
	return callbackData[dataPtr];
}
function remove_callback_data_pointer(dataPtr) {
	if (dataPtr === 0) return;
	callbackData[dataPtr] = void 0;
	freeCallbackData.push(dataPtr);
}
function color_from_int(color) {
	return {
		red: color >> 8 & 255,
		green: color >> 16 & 255,
		blue: color >> 24 & 255,
		alpha: color & 255
	};
}
function color_to_int(color) {
	return (color.red << 8 | color.green << 16 | color.blue << 24 | color.alpha) >>> 0;
}
//#endregion
//#region src/types.ts
/** Flags that describe the properties of a color palette. */
const ColorPaletteFlags = {
	DEFAULT: 0,
	USABLE_WITH_LIGHT_BACKGROUND: 1,
	USABLE_WITH_DARK_BACKGROUND: 2
};
/**
* The values of this enumeration determine how color values outside the minimum
* and maximum defined offset on a {@link ColorLine} are determined.
*
* See the OpenType spec
* [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr) section
* for details.
*/
const PaintExtend = {
	PAD: 0,
	REPEAT: 1,
	REFLECT: 2
};
/**
* The values of this enumeration describe the compositing modes that can be used
* when combining temporary redirected drawing with the backdrop.
*
* See the OpenType spec
* [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr) section
* for details.
*/
const PaintCompositeMode = {
	CLEAR: 0,
	SRC: 1,
	DEST: 2,
	SRC_OVER: 3,
	DEST_OVER: 4,
	SRC_IN: 5,
	DEST_IN: 6,
	SRC_OUT: 7,
	DEST_OUT: 8,
	SRC_ATOP: 9,
	DEST_ATOP: 10,
	XOR: 11,
	PLUS: 12,
	SCREEN: 13,
	OVERLAY: 14,
	DARKEN: 15,
	LIGHTEN: 16,
	COLOR_DODGE: 17,
	COLOR_BURN: 18,
	HARD_LIGHT: 19,
	SOFT_LIGHT: 20,
	DIFFERENCE: 21,
	EXCLUSION: 22,
	MULTIPLY: 23,
	HSL_HUE: 24,
	HSL_SATURATION: 25,
	HSL_COLOR: 26,
	HSL_LUMINOSITY: 27
};
/** Flags for {@link AxisInfo}. */
const AxisFlags = { HIDDEN: 1 };
const GlyphFlag = {
	UNSAFE_TO_BREAK: 1,
	UNSAFE_TO_CONCAT: 2,
	SAFE_TO_INSERT_TATWEEL: 4,
	DEFINED: 7
};
//#endregion
//#region src/blob.ts
/**
* An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-blob.html | HarfBuzz blob}.
* A blob wraps a chunk of binary data, typically the contents of a font file.
*/
var Blob = class {
	/**
	* @param data Binary font data.
	*/
	constructor(data) {
		const array = data instanceof Uint8Array ? data : new Uint8Array(data);
		const blobPtr = exports.malloc(array.byteLength);
		Module.HEAPU8.set(array, blobPtr);
		this.ptr = exports.hb_blob_create(blobPtr, array.byteLength, 2, blobPtr, freeFuncPtr);
		track(this, exports.hb_blob_destroy);
	}
};
//#endregion
//#region src/face.ts
const HB_OT_NAME_ID_INVALID = 65535;
const GlyphClass = {
	UNCLASSIFIED: 0,
	BASE_GLYPH: 1,
	LIGATURE: 2,
	MARK: 3,
	COMPONENT: 4
};
/**
* An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-face.html | HarfBuzz face}.
* A face represents a single face in a binary font file and is the
* foundation for creating Font objects used in text shaping.
*/
var Face = class {
	constructor(arg, index = 0) {
		if (typeof arg === "number") this.ptr = exports.hb_face_reference(arg);
		else this.ptr = exports.hb_face_create(arg.ptr, index);
		this.upem = exports.hb_face_get_upem(this.ptr);
		track(this, exports.hb_face_destroy);
	}
	/**
	* Return the binary contents of an OpenType table.
	* @param table Table name
	* @returns A Uint8Array of the table data, or undefined if the table is not found.
	*/
	referenceTable(table) {
		const blob = exports.hb_face_reference_table(this.ptr, hb_tag(table));
		const length = exports.hb_blob_get_length(blob);
		if (!length) return;
		const blobptr = exports.hb_blob_get_data(blob, 0);
		return Module.HEAPU8.subarray(blobptr, blobptr + length);
	}
	/**
	* Return variation axis infos.
	* @returns A dictionary mapping axis tags to {@link AxisInfo} values.
	*/
	getAxisInfos() {
		const sp = Module.stackSave();
		const axis = Module.stackAlloc(2048);
		const c = Module.stackAlloc(4);
		Module.HEAPU32[c / 4] = 64;
		exports.hb_ot_var_get_axis_infos(this.ptr, 0, c, axis);
		const result = {};
		Array.from({ length: Module.HEAPU32[c / 4] }).forEach((_, i) => {
			const info = {
				axisIndex: Module.HEAPU32[axis / 4 + i * 8],
				tag: hb_untag(Module.HEAPU32[axis / 4 + i * 8 + 1]),
				nameId: Module.HEAPU32[axis / 4 + i * 8 + 2],
				flags: Module.HEAPU32[axis / 4 + i * 8 + 3],
				min: Module.HEAPF32[axis / 4 + i * 8 + 4],
				default: Module.HEAPF32[axis / 4 + i * 8 + 5],
				max: Module.HEAPF32[axis / 4 + i * 8 + 6]
			};
			result[info.tag] = info;
		});
		Module.stackRestore(sp);
		return result;
	}
	/**
	* Return unicodes the face supports.
	* @returns A Uint32Array of supported Unicode code points.
	*/
	collectUnicodes() {
		const unicodeSetPtr = exports.hb_set_create();
		exports.hb_face_collect_unicodes(this.ptr, unicodeSetPtr);
		const result = typed_array_from_set(unicodeSetPtr);
		exports.hb_set_destroy(unicodeSetPtr);
		return result;
	}
	/**
	* Return all scripts enumerated in the specified face's
	* GSUB table or GPOS table.
	* @param table The table to query, either "GSUB" or "GPOS".
	* @returns An array of 4-character script tag strings.
	*/
	getTableScriptTags(table) {
		const sp = Module.stackSave();
		const tableTag = hb_tag(table);
		let startOffset = 0;
		let scriptCount = 128;
		const scriptCountPtr = Module.stackAlloc(4);
		const scriptTagsPtr = Module.stackAlloc(512);
		const tags = [];
		while (scriptCount == 128) {
			Module.HEAPU32[scriptCountPtr / 4] = scriptCount;
			exports.hb_ot_layout_table_get_script_tags(this.ptr, tableTag, startOffset, scriptCountPtr, scriptTagsPtr);
			scriptCount = Module.HEAPU32[scriptCountPtr / 4];
			const scriptTags = Module.HEAPU32.subarray(scriptTagsPtr / 4, scriptTagsPtr / 4 + scriptCount);
			tags.push(...Array.from(scriptTags).map(hb_untag));
			startOffset += scriptCount;
		}
		Module.stackRestore(sp);
		return tags;
	}
	/**
	* Return all features enumerated in the specified face's
	* GSUB table or GPOS table.
	* @param table The table to query, either "GSUB" or "GPOS".
	* @returns An array of 4-character feature tag strings.
	*/
	getTableFeatureTags(table) {
		const sp = Module.stackSave();
		const tableTag = hb_tag(table);
		let startOffset = 0;
		let featureCount = 128;
		const featureCountPtr = Module.stackAlloc(4);
		const featureTagsPtr = Module.stackAlloc(512);
		const tags = [];
		while (featureCount == 128) {
			Module.HEAPU32[featureCountPtr / 4] = featureCount;
			exports.hb_ot_layout_table_get_feature_tags(this.ptr, tableTag, startOffset, featureCountPtr, featureTagsPtr);
			featureCount = Module.HEAPU32[featureCountPtr / 4];
			const featureTags = Module.HEAPU32.subarray(featureTagsPtr / 4, featureTagsPtr / 4 + featureCount);
			tags.push(...Array.from(featureTags).map(hb_untag));
			startOffset += featureCount;
		}
		Module.stackRestore(sp);
		return tags;
	}
	/**
	* Return language tags in the given face's GSUB or GPOS table, underneath
	* the specified script index.
	* @param table The table to query, either "GSUB" or "GPOS".
	* @param scriptIndex The index of the script to query.
	* @returns An array of 4-character language tag strings.
	*/
	getScriptLanguageTags(table, scriptIndex) {
		const sp = Module.stackSave();
		const tableTag = hb_tag(table);
		let startOffset = 0;
		let languageCount = 128;
		const languageCountPtr = Module.stackAlloc(4);
		const languageTagsPtr = Module.stackAlloc(512);
		const tags = [];
		while (languageCount == 128) {
			Module.HEAPU32[languageCountPtr / 4] = languageCount;
			exports.hb_ot_layout_script_get_language_tags(this.ptr, tableTag, scriptIndex, startOffset, languageCountPtr, languageTagsPtr);
			languageCount = Module.HEAPU32[languageCountPtr / 4];
			const languageTags = Module.HEAPU32.subarray(languageTagsPtr / 4, languageTagsPtr / 4 + languageCount);
			tags.push(...Array.from(languageTags).map(hb_untag));
			startOffset += languageCount;
		}
		Module.stackRestore(sp);
		return tags;
	}
	/**
	* Return all features in the specified face's GSUB table or GPOS table,
	* underneath the specified script and language.
	* @param table The table to query, either "GSUB" or "GPOS".
	* @param scriptIndex The index of the script to query.
	* @param languageIndex The index of the language to query.
	* @returns An array of 4-character feature tag strings.
	*/
	getLanguageFeatureTags(table, scriptIndex, languageIndex) {
		const sp = Module.stackSave();
		const tableTag = hb_tag(table);
		let startOffset = 0;
		let featureCount = 128;
		const featureCountPtr = Module.stackAlloc(4);
		const featureTagsPtr = Module.stackAlloc(512);
		const tags = [];
		while (featureCount == 128) {
			Module.HEAPU32[featureCountPtr / 4] = featureCount;
			exports.hb_ot_layout_language_get_feature_tags(this.ptr, tableTag, scriptIndex, languageIndex, startOffset, featureCountPtr, featureTagsPtr);
			featureCount = Module.HEAPU32[featureCountPtr / 4];
			const featureTags = Module.HEAPU32.subarray(featureTagsPtr / 4, featureTagsPtr / 4 + featureCount);
			tags.push(...Array.from(featureTags).map(hb_untag));
			startOffset += featureCount;
		}
		Module.stackRestore(sp);
		return tags;
	}
	/**
	* Fetches a list of all lookups enumerated for the specified feature, in
	* the specified face's GSUB table or GPOS table.
	* @param table The table to query, either "GSUB" or "GPOS".
	* @param featureIndex The index of the requested feature.
	* @returns An array of lookup indexes.
	*/
	getFeatureLookups(table, featureIndex) {
		const sp = Module.stackSave();
		const tableTag = hb_tag(table);
		let startOffset = 0;
		let lookupCount = 128;
		const lookupCountPtr = Module.stackAlloc(4);
		const lookupIndexesPtr = Module.stackAlloc(512);
		const lookups = [];
		while (lookupCount == 128) {
			Module.HEAPU32[lookupCountPtr / 4] = lookupCount;
			exports.hb_ot_layout_feature_get_lookups(this.ptr, tableTag, featureIndex, startOffset, lookupCountPtr, lookupIndexesPtr);
			lookupCount = Module.HEAPU32[lookupCountPtr / 4];
			const lookupIndexes = Module.HEAPU32.subarray(lookupIndexesPtr / 4, lookupIndexesPtr / 4 + lookupCount);
			lookups.push(...Array.from(lookupIndexes));
			startOffset += lookupCount;
		}
		Module.stackRestore(sp);
		return lookups;
	}
	/**
	* Get the GDEF class of the requested glyph.
	* @param glyph The glyph to get the class of.
	* @returns The {@link GlyphClass} of the glyph.
	*/
	getGlyphClass(glyph) {
		return exports.hb_ot_layout_get_glyph_class(this.ptr, glyph);
	}
	/**
	* Return all names in the specified face's name table.
	* @returns An array of {nameId, language} entries.
	*/
	listNames() {
		const sp = Module.stackSave();
		const numEntriesPtr = Module.stackAlloc(4);
		const entriesPtr = exports.hb_ot_name_list_names(this.ptr, numEntriesPtr);
		const numEntries = Module.HEAPU32[numEntriesPtr / 4];
		const entries = [];
		for (let i = 0; i < numEntries; i++) entries.push({
			nameId: Module.HEAPU32[entriesPtr / 4 + i * 3],
			language: language_to_string(Module.HEAPU32[entriesPtr / 4 + i * 3 + 2])
		});
		Module.stackRestore(sp);
		return entries;
	}
	/**
	* Get the name of the specified face.
	* @param nameId The ID of the name to get.
	* @param language The language of the name to get.
	* @returns The name string.
	*/
	getName(nameId, language) {
		const sp = Module.stackSave();
		const languagePtr = language_from_string(language);
		const nameLen = exports.hb_ot_name_get_utf16(this.ptr, nameId, languagePtr, 0, 0) + 1;
		const textSizePtr = Module.stackAlloc(4);
		const textPtr = exports.malloc(nameLen * 2);
		Module.HEAPU32[textSizePtr / 4] = nameLen;
		exports.hb_ot_name_get_utf16(this.ptr, nameId, languagePtr, textSizePtr, textPtr);
		const name = utf16_ptr_to_string(textPtr, nameLen - 1);
		exports.free(textPtr);
		Module.stackRestore(sp);
		return name;
	}
	/**
	* Get the name IDs of the specified feature.
	* @param table The table to query, either "GSUB" or "GPOS".
	* @param featureIndex The index of the feature to query.
	* @returns An object with name IDs, or undefined if not found.
	*/
	getFeatureNameIds(table, featureIndex) {
		const sp = Module.stackSave();
		const tableTag = hb_tag(table);
		const labelIdPtr = Module.stackAlloc(4);
		const tooltipIdPtr = Module.stackAlloc(4);
		const sampleIdPtr = Module.stackAlloc(4);
		const numNamedParametersPtr = Module.stackAlloc(4);
		const firstParameterIdPtr = Module.stackAlloc(4);
		const found = exports.hb_ot_layout_feature_get_name_ids(this.ptr, tableTag, featureIndex, labelIdPtr, tooltipIdPtr, sampleIdPtr, numNamedParametersPtr, firstParameterIdPtr);
		let names;
		if (found) {
			const uiLabelNameId = Module.HEAPU32[labelIdPtr / 4];
			const uiTooltipTextNameId = Module.HEAPU32[tooltipIdPtr / 4];
			const sampleTextNameId = Module.HEAPU32[sampleIdPtr / 4];
			const numNamedParameters = Module.HEAPU32[numNamedParametersPtr / 4];
			const firstParameterId = Module.HEAPU32[firstParameterIdPtr / 4];
			names = { paramUiLabelNameIds: Array.from({ length: numNamedParameters }, (_, i) => firstParameterId + i) };
			if (uiLabelNameId != HB_OT_NAME_ID_INVALID) names.uiLabelNameId = uiLabelNameId;
			if (uiTooltipTextNameId != HB_OT_NAME_ID_INVALID) names.uiTooltipTextNameId = uiTooltipTextNameId;
			if (sampleTextNameId != HB_OT_NAME_ID_INVALID) names.sampleTextNameId = sampleTextNameId;
		}
		Module.stackRestore(sp);
		return names;
	}
	/**
	* Tests whether a face includes a `CPAL` color-palette table.
	* @returns `true` if data found, `false` otherwise.
	*/
	hasColorPalettes() {
		return !!exports.hb_ot_color_has_palettes(this.ptr);
	}
	/**
	* Fetches the color palettes in the face's `CPAL` table.
	* @returns An array of the face's {@link ColorPalette | color palettes}.
	*/
	getColorPalettes() {
		const count = exports.hb_ot_color_palette_get_count(this.ptr);
		const palettes = [];
		const sp = Module.stackSave();
		const countPtr = Module.stackAlloc(4);
		const colorsPtr = Module.stackAlloc(512);
		for (let i = 0; i < count; i++) {
			const colors = [];
			let startOffset = 0;
			let colorCount = 128;
			while (colorCount === 128) {
				Module.HEAPU32[countPtr / 4] = colorCount;
				exports.hb_ot_color_palette_get_colors(this.ptr, i, startOffset, countPtr, colorsPtr);
				colorCount = Module.HEAPU32[countPtr / 4];
				for (let j = 0; j < colorCount; j++) {
					const color = color_from_int(Module.HEAPU32[colorsPtr / 4 + j]);
					const nameId = exports.hb_ot_color_palette_color_get_name_id(this.ptr, startOffset + j);
					if (nameId != HB_OT_NAME_ID_INVALID) color.nameId = nameId;
					colors.push(color);
				}
				startOffset += colorCount;
			}
			const palette = {
				colors,
				flags: exports.hb_ot_color_palette_get_flags(this.ptr, i)
			};
			const nameId = exports.hb_ot_color_palette_get_name_id(this.ptr, i);
			if (nameId != HB_OT_NAME_ID_INVALID) palette.nameId = nameId;
			palettes.push(palette);
		}
		Module.stackRestore(sp);
		return palettes;
	}
	/**
	* Tests whether a face includes a `COLR` table with data according to COLRv0.
	* @returns `true` if data found, `false` otherwise.
	*/
	hasColorLayers() {
		return !!exports.hb_ot_color_has_layers(this.ptr);
	}
	/**
	* Fetches a list of all color layers for the specified glyph index in the
	* specified face.
	* @param glyph The glyph index to query.
	* @returns An array of the glyph's {@link ColorLayer | color layers}.
	*/
	getGlyphColorLayers(glyph) {
		const layers = [];
		const sp = Module.stackSave();
		const countPtr = Module.stackAlloc(4);
		const layersPtr = Module.stackAlloc(1024);
		let startOffset = 0;
		let layerCount = 128;
		while (layerCount === 128) {
			Module.HEAPU32[countPtr / 4] = layerCount;
			exports.hb_ot_color_glyph_get_layers(this.ptr, glyph, startOffset, countPtr, layersPtr);
			layerCount = Module.HEAPU32[countPtr / 4];
			for (let i = 0; i < layerCount; i++) {
				const o = layersPtr / 4 + i * 2;
				const layer = { glyph: Module.HEAPU32[o] };
				const colorIndex = Module.HEAPU32[o + 1];
				if (colorIndex != 65535) layer.colorIndex = colorIndex;
				layers.push(layer);
			}
			startOffset += layerCount;
		}
		Module.stackRestore(sp);
		return layers;
	}
	/**
	* Tests whether a face includes a `COLR` table with data according to COLRv1.
	* @returns `true` if data found, `false` otherwise.
	*/
	hasColorPaint() {
		return !!exports.hb_ot_color_has_paint(this.ptr);
	}
	/**
	* Tests whether a face includes COLRv1 paint data for a glyph.
	* @param glyph The glyph index to query.
	* @returns `true` if data found, `false` otherwise.
	*/
	glyphHasColorPaint(glyph) {
		return !!exports.hb_ot_color_glyph_has_paint(this.ptr, glyph);
	}
	/**
	* Tests whether a face has PNG glyph images (either in `CBDT` or `sbix`
	* tables).
	* @returns `true` if data found, `false` otherwise.
	*/
	hasColorPng() {
		return !!exports.hb_ot_color_has_png(this.ptr);
	}
};
//#endregion
//#region src/draw-funcs.ts
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
var DrawFuncs = class {
	constructor() {
		this.funcPtrs = [];
		this.userDataPtrs = [];
		this.ptr = exports.hb_draw_funcs_create();
		const ptr = this.ptr;
		const funcPtrs = this.funcPtrs;
		const userDataPtrs = this.userDataPtrs;
		registry.register(this, () => {
			exports.hb_draw_funcs_destroy(ptr);
			for (const ptr of funcPtrs) Module.removeFunction(ptr);
			for (const ptr of userDataPtrs) remove_callback_data_pointer(ptr);
		});
	}
	/**
	* Sets move-to callback to the draw functions object.
	* @param func The move-to callback.
	* @param userData Data to pass to `func`.
	*/
	setMoveToFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((dfuncs, draw_data, draw_state, toX, toY, user_data) => {
			func(toX, toY, get_callback_data(draw_data), get_callback_data(user_data));
		}, "viiiffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_draw_funcs_set_move_to_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets line-to callback to the draw functions object.
	* @param func The line-to callback.
	* @param userData Data to pass to `func`.
	*/
	setLineToFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((dfuncs, draw_data, draw_state, toX, toY, user_data) => {
			func(toX, toY, get_callback_data(draw_data), get_callback_data(user_data));
		}, "viiiffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_draw_funcs_set_line_to_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets quadratic-to callback to the draw functions object.
	* @param func The quadratic-to callback.
	* @param userData Data to pass to `func`.
	*/
	setQuadraticToFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((dfuncs, draw_data, draw_state, cX, cY, toX, toY, user_data) => {
			func(cX, cY, toX, toY, get_callback_data(draw_data), get_callback_data(user_data));
		}, "viiiffffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_draw_funcs_set_quadratic_to_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets cubic-to callback to the draw functions object.
	* @param func The cubic-to callback.
	* @param userData Data to pass to `func`.
	*/
	setCubicToFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((dfuncs, draw_data, draw_state, c1X, c1Y, c2X, c2Y, toX, toY, user_data) => {
			func(c1X, c1Y, c2X, c2Y, toX, toY, get_callback_data(draw_data), get_callback_data(user_data));
		}, "viiiffffffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_draw_funcs_set_cubic_to_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets close-path callback to the draw functions object.
	* @param func The close-path callback.
	* @param userData Data to pass to `func`.
	*/
	setClosePathFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((dfuncs, draw_data, draw_state, user_data) => {
			func(get_callback_data(draw_data), get_callback_data(user_data));
		}, "viiii");
		this.funcPtrs.push(funcPtr);
		exports.hb_draw_funcs_set_close_path_func(this.ptr, funcPtr, userDataPtr, 0);
	}
};
//#endregion
//#region src/font.ts
/**
* Metric tags corresponding to [MVAR Value
* Tags](https://docs.microsoft.com/en-us/typography/opentype/spec/mvar#value-tags).
*/
const MetricsTag = {
	HORIZONTAL_ASCENDER: hb_tag("hasc"),
	HORIZONTAL_DESCENDER: hb_tag("hdsc"),
	HORIZONTAL_LINE_GAP: hb_tag("hlgp"),
	HORIZONTAL_CLIPPING_ASCENT: hb_tag("hcla"),
	HORIZONTAL_CLIPPING_DESCENT: hb_tag("hcld"),
	VERTICAL_ASCENDER: hb_tag("vasc"),
	VERTICAL_DESCENDER: hb_tag("vdsc"),
	VERTICAL_LINE_GAP: hb_tag("vlgp"),
	HORIZONTAL_CARET_RISE: hb_tag("hcrs"),
	HORIZONTAL_CARET_RUN: hb_tag("hcrn"),
	HORIZONTAL_CARET_OFFSET: hb_tag("hcof"),
	VERTICAL_CARET_RISE: hb_tag("vcrs"),
	VERTICAL_CARET_RUN: hb_tag("vcrn"),
	VERTICAL_CARET_OFFSET: hb_tag("vcof"),
	X_HEIGHT: hb_tag("xhgt"),
	CAP_HEIGHT: hb_tag("cpht"),
	SUBSCRIPT_EM_X_SIZE: hb_tag("sbxs"),
	SUBSCRIPT_EM_Y_SIZE: hb_tag("sbys"),
	SUBSCRIPT_EM_X_OFFSET: hb_tag("sbxo"),
	SUBSCRIPT_EM_Y_OFFSET: hb_tag("sbyo"),
	SUPERSCRIPT_EM_X_SIZE: hb_tag("spxs"),
	SUPERSCRIPT_EM_Y_SIZE: hb_tag("spys"),
	SUPERSCRIPT_EM_X_OFFSET: hb_tag("spxo"),
	SUPERSCRIPT_EM_Y_OFFSET: hb_tag("spyo"),
	STRIKEOUT_SIZE: hb_tag("strs"),
	STRIKEOUT_OFFSET: hb_tag("stro"),
	UNDERLINE_SIZE: hb_tag("unds"),
	UNDERLINE_OFFSET: hb_tag("undo")
};
let pathDrawFuncs;
function getPathDrawFuncs() {
	if (!pathDrawFuncs) {
		pathDrawFuncs = new DrawFuncs();
		pathDrawFuncs.setMoveToFunc((x, y, path) => {
			path.push(`M${x},${y}`);
		});
		pathDrawFuncs.setLineToFunc((x, y, path) => {
			path.push(`L${x},${y}`);
		});
		pathDrawFuncs.setCubicToFunc((c1x, c1y, c2x, c2y, x, y, path) => {
			path.push(`C${c1x},${c1y} ${c2x},${c2y} ${x},${y}`);
		});
		pathDrawFuncs.setQuadraticToFunc((cx, cy, x, y, path) => {
			path.push(`Q${cx},${cy} ${x},${y}`);
		});
		pathDrawFuncs.setClosePathFunc((path) => {
			path.push("Z");
		});
	}
	return pathDrawFuncs;
}
let jsonDrawFuncs;
function getJsonDrawFuncs() {
	if (!jsonDrawFuncs) {
		jsonDrawFuncs = new DrawFuncs();
		jsonDrawFuncs.setMoveToFunc((x, y, commands) => {
			commands.push({
				type: "M",
				values: [x, y]
			});
		});
		jsonDrawFuncs.setLineToFunc((x, y, commands) => {
			commands.push({
				type: "L",
				values: [x, y]
			});
		});
		jsonDrawFuncs.setCubicToFunc((c1x, c1y, c2x, c2y, x, y, commands) => {
			commands.push({
				type: "C",
				values: [
					c1x,
					c1y,
					c2x,
					c2y,
					x,
					y
				]
			});
		});
		jsonDrawFuncs.setQuadraticToFunc((cx, cy, x, y, commands) => {
			commands.push({
				type: "Q",
				values: [
					cx,
					cy,
					x,
					y
				]
			});
		});
		jsonDrawFuncs.setClosePathFunc((commands) => {
			commands.push({
				type: "Z",
				values: []
			});
		});
	}
	return jsonDrawFuncs;
}
/**
* An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-font.html | HarfBuzz font}.
* A font represents a face at a specific size and with certain other
* parameters (pixels-per-em, variation settings) specified. Fonts are the
* primary input to the shaping process.
*/
var Font = class Font {
	constructor(arg) {
		if (typeof arg === "number") this.ptr = exports.hb_font_reference(arg);
		else {
			this.ptr = exports.hb_font_create(arg.ptr);
			this._face = arg;
		}
		track(this, exports.hb_font_destroy);
	}
	/** The {@link Face} associated with this font. */
	get face() {
		if (!this._face) this._face = new Face(exports.hb_font_get_face(this.ptr));
		return this._face;
	}
	/**
	* Create a sub font that inherits this font's properties.
	* @returns A new Font object representing the sub font.
	*/
	subFont() {
		return new Font(exports.hb_font_create_sub_font(this.ptr));
	}
	/**
	* Return font horizontal extents.
	* @returns Object with ascender, descender, and lineGap properties.
	*/
	hExtents() {
		const sp = Module.stackSave();
		const extentsPtr = Module.stackAlloc(48);
		exports.hb_font_get_h_extents(this.ptr, extentsPtr);
		const extents = {
			ascender: Module.HEAP32[extentsPtr / 4],
			descender: Module.HEAP32[extentsPtr / 4 + 1],
			lineGap: Module.HEAP32[extentsPtr / 4 + 2]
		};
		Module.stackRestore(sp);
		return extents;
	}
	/**
	* Return font vertical extents.
	* @returns Object with ascender, descender, and lineGap properties.
	*/
	vExtents() {
		const sp = Module.stackSave();
		const extentsPtr = Module.stackAlloc(48);
		exports.hb_font_get_v_extents(this.ptr, extentsPtr);
		const extents = {
			ascender: Module.HEAP32[extentsPtr / 4],
			descender: Module.HEAP32[extentsPtr / 4 + 1],
			lineGap: Module.HEAP32[extentsPtr / 4 + 2]
		};
		Module.stackRestore(sp);
		return extents;
	}
	/**
	* Return glyph name.
	* @param glyphId ID of the requested glyph in the font.
	* @returns The glyph name string.
	*/
	glyphName(glyphId) {
		const sp = Module.stackSave();
		const strSize = 256;
		const strPtr = Module.stackAlloc(strSize);
		exports.hb_font_glyph_to_string(this.ptr, glyphId, strPtr, strSize);
		const name = utf8_ptr_to_string(strPtr);
		Module.stackRestore(sp);
		return name;
	}
	/**
	* Draws the outline that corresponds to a glyph in the specified font.
	*
	* The outline is returned by way of calls to the callbacks of the `drawFuncs`
	* object, with `drawData` passed to them.
	* @param glyphId The glyph ID.
	* @param drawFuncs The {@link DrawFuncs} to draw to.
	* @param drawData User data to pass to draw callbacks.
	*/
	drawGlyph(glyphId, drawFuncs, drawData) {
		const drawDataPtr = register_callback_data_pointer(drawData);
		try {
			exports.hb_font_draw_glyph(this.ptr, glyphId, drawFuncs.ptr, drawDataPtr);
		} finally {
			remove_callback_data_pointer(drawDataPtr);
		}
	}
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
	drawGlyphOrFail(glyphId, drawFuncs, drawData) {
		const drawDataPtr = register_callback_data_pointer(drawData);
		try {
			return !!exports.hb_font_draw_glyph_or_fail(this.ptr, glyphId, drawFuncs.ptr, drawDataPtr);
		} finally {
			remove_callback_data_pointer(drawDataPtr);
		}
	}
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
	paintGlyph(glyphId, paintFuncs, paintData, paletteIndex = 0, foreground = {
		red: 0,
		green: 0,
		blue: 0,
		alpha: 255
	}) {
		const paintDataPtr = register_callback_data_pointer(paintData);
		try {
			exports.hb_font_paint_glyph(this.ptr, glyphId, paintFuncs.ptr, paintDataPtr, paletteIndex, color_to_int(foreground));
		} finally {
			remove_callback_data_pointer(paintDataPtr);
		}
	}
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
	paintGlyphOrFail(glyphId, paintFuncs, paintData, paletteIndex = 0, foreground = {
		red: 0,
		green: 0,
		blue: 0,
		alpha: 255
	}) {
		const paintDataPtr = register_callback_data_pointer(paintData);
		try {
			return !!exports.hb_font_paint_glyph_or_fail(this.ptr, glyphId, paintFuncs.ptr, paintDataPtr, paletteIndex, color_to_int(foreground));
		} finally {
			remove_callback_data_pointer(paintDataPtr);
		}
	}
	/**
	* Fetches the PNG image for a glyph.
	*
	* To get an optimally sized PNG blob, the PPEM values must be set on the font.
	* If PPEM is unset, the blob returned will be the largest PNG available.
	* @param glyphId A glyph index.
	* @returns The PNG image for the glyph, or `undefined` if the glyph has no PNG
	* image.
	*/
	getGlyphColorPng(glyphId) {
		const blob = exports.hb_ot_color_glyph_reference_png(this.ptr, glyphId);
		const length = exports.hb_blob_get_length(blob);
		let png;
		if (length) {
			const dataPtr = exports.hb_blob_get_data(blob, 0);
			png = Module.HEAPU8.slice(dataPtr, dataPtr + length);
		}
		exports.hb_blob_destroy(blob);
		return png;
	}
	/**
	* Return a glyph as an SVG path string.
	* @param glyphId ID of the requested glyph in the font.
	* @returns SVG path data string.
	*/
	glyphToPath(glyphId) {
		const path = [];
		this.drawGlyph(glyphId, getPathDrawFuncs(), path);
		return path.join("");
	}
	/**
	* Return glyph horizontal advance.
	* @param glyphId ID of the requested glyph in the font.
	* @returns The horizontal advance width.
	*/
	glyphHAdvance(glyphId) {
		return exports.hb_font_get_glyph_h_advance(this.ptr, glyphId);
	}
	/**
	* Return glyph vertical advance.
	* @param glyphId ID of the requested glyph in the font.
	* @returns The vertical advance height.
	*/
	glyphVAdvance(glyphId) {
		return exports.hb_font_get_glyph_v_advance(this.ptr, glyphId);
	}
	/**
	* Return glyph horizontal origin.
	* @param glyphId ID of the requested glyph in the font.
	* @returns [x, y] origin coordinates, or undefined if not available.
	*/
	glyphHOrigin(glyphId) {
		const sp = Module.stackSave();
		const xPtr = Module.stackAlloc(4);
		const yPtr = Module.stackAlloc(4);
		let origin;
		if (exports.hb_font_get_glyph_h_origin(this.ptr, glyphId, xPtr, yPtr)) origin = [Module.HEAP32[xPtr / 4], Module.HEAP32[yPtr / 4]];
		Module.stackRestore(sp);
		return origin;
	}
	/**
	* Return glyph vertical origin.
	* @param glyphId ID of the requested glyph in the font.
	* @returns [x, y] origin coordinates, or undefined if not available.
	*/
	glyphVOrigin(glyphId) {
		const sp = Module.stackSave();
		const xPtr = Module.stackAlloc(4);
		const yPtr = Module.stackAlloc(4);
		let origin;
		if (exports.hb_font_get_glyph_v_origin(this.ptr, glyphId, xPtr, yPtr)) origin = [Module.HEAP32[xPtr / 4], Module.HEAP32[yPtr / 4]];
		Module.stackRestore(sp);
		return origin;
	}
	/**
	* Return glyph extents.
	* @param glyphId ID of the requested glyph in the font.
	* @returns An object with xBearing, yBearing, width, and height, or undefined.
	*/
	glyphExtents(glyphId) {
		const sp = Module.stackSave();
		const extentsPtr = Module.stackAlloc(16);
		let extents;
		if (exports.hb_font_get_glyph_extents(this.ptr, glyphId, extentsPtr)) extents = {
			xBearing: Module.HEAP32[extentsPtr / 4],
			yBearing: Module.HEAP32[extentsPtr / 4 + 1],
			width: Module.HEAP32[extentsPtr / 4 + 2],
			height: Module.HEAP32[extentsPtr / 4 + 3]
		};
		Module.stackRestore(sp);
		return extents;
	}
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
	glyph(unicode, variationSelector = 0) {
		const sp = Module.stackSave();
		const glyphIdPtr = Module.stackAlloc(4);
		let glyphId;
		if (exports.hb_font_get_glyph(this.ptr, unicode, variationSelector, glyphIdPtr)) glyphId = Module.HEAPU32[glyphIdPtr / 4];
		Module.stackRestore(sp);
		return glyphId;
	}
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
	nominalGlyph(unicode) {
		const sp = Module.stackSave();
		const glyphIdPtr = Module.stackAlloc(4);
		let glyphId;
		if (exports.hb_font_get_nominal_glyph(this.ptr, unicode, glyphIdPtr)) glyphId = Module.HEAPU32[glyphIdPtr / 4];
		Module.stackRestore(sp);
		return glyphId;
	}
	/**
	* Fetches the glyph ID for a Unicode code point when followed by
	* by the specified variation-selector code point, in the specified
	* font.
	*
	* @param unicode The Unicode code point to query.
	* @param variationSelector The variation-selector code point to query.
	* @returns The glyph ID, or undefined if not found.
	*/
	variationGlyph(unicode, variationSelector) {
		const sp = Module.stackSave();
		const glyphIdPtr = Module.stackAlloc(4);
		let glyphId;
		if (exports.hb_font_get_variation_glyph(this.ptr, unicode, variationSelector, glyphIdPtr)) glyphId = Module.HEAPU32[glyphIdPtr / 4];
		Module.stackRestore(sp);
		return glyphId;
	}
	/**
	* Return glyph ID from name.
	* @param name Name of the requested glyph in the font.
	* @returns The glyph ID, or undefined if not found.
	*/
	glyphFromName(name) {
		const sp = Module.stackSave();
		const glyphIdPtr = Module.stackAlloc(4);
		const namePtr = string_to_utf8_ptr(name);
		let glyphId;
		if (exports.hb_font_get_glyph_from_name(this.ptr, namePtr.ptr, namePtr.length, glyphIdPtr)) glyphId = Module.HEAPU32[glyphIdPtr / 4];
		namePtr.free();
		Module.stackRestore(sp);
		return glyphId;
	}
	/**
	* Return a glyph as a JSON path string
	* based on format described on https://svgwg.org/specs/paths/#InterfaceSVGPathSegment
	* @param glyphId ID of the requested glyph in the font.
	* @returns An array of path segment objects with type and values.
	*/
	glyphToJson(glyphId) {
		const commands = [];
		this.drawGlyph(glyphId, getJsonDrawFuncs(), commands);
		return commands;
	}
	/**
	* Set the font's scale factor, affecting the position values returned from
	* shaping.
	* @param xScale Units to scale in the X dimension.
	* @param yScale Units to scale in the Y dimension.
	*/
	setScale(xScale, yScale) {
		exports.hb_font_set_scale(this.ptr, xScale, yScale);
	}
	/**
	* Applies a list of font-variation settings to a font.
	*
	* Note that this overrides all existing variations set on the font.
	* Axes not included in `variations` will be effectively set to their
	* default values.
	*
	* @param variations Array of variation settings to apply.
	*/
	setVariations(variations) {
		const sp = Module.stackSave();
		const vars = Module.stackAlloc(8 * variations.length);
		variations.forEach((variation, i) => {
			variation.writeTo(vars + i * 8);
		});
		exports.hb_font_set_variations(this.ptr, vars, variations.length);
		Module.stackRestore(sp);
	}
	/** Set the font's font functions. */
	setFuncs(fontFuncs) {
		exports.hb_font_set_funcs(this.ptr, fontFuncs.ptr);
	}
	/**
	* Fetches the optical bound of a glyph positioned at the margin of text.
	* The direction identifies which edge of the glyph to query.
	* @param lookupIndex Index of the feature lookup to query.
	* @param direction Edge of the glyph to query.
	* @param glyph A glyph id.
	* @returns Adjustment value. Negative values mean the glyph will stick out of the margin.
	*/
	getLookupOpticalBound(lookupIndex, direction, glyph) {
		return exports.hb_ot_layout_lookup_get_optical_bound(this.ptr, lookupIndex, direction, glyph);
	}
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
	getLigatureCarets(direction, glyph) {
		const sp = Module.stackSave();
		let startOffset = 0;
		let caretCount = 128;
		const caretCountPtr = Module.stackAlloc(4);
		const caretArrayPtr = Module.stackAlloc(512);
		const carets = [];
		while (caretCount == 128) {
			Module.HEAPU32[caretCountPtr / 4] = caretCount;
			exports.hb_ot_layout_get_ligature_carets(this.ptr, direction, glyph, startOffset, caretCountPtr, caretArrayPtr);
			caretCount = Module.HEAPU32[caretCountPtr / 4];
			const caretArray = Module.HEAP32.subarray(caretArrayPtr / 4, caretArrayPtr / 4 + caretCount);
			carets.push(...Array.from(caretArray));
			startOffset += caretCount;
		}
		Module.stackRestore(sp);
		return carets;
	}
	/**
	* Fetches metrics value corresponding to `metricsTag` from the font.
	*
	* @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
	* @returns The metrics value, or undefined if not found in the font.
	*/
	getMetricPosition(metricsTag) {
		const sp = Module.stackSave();
		const positionPtr = Module.stackAlloc(4);
		let position;
		if (exports.hb_ot_metrics_get_position(this.ptr, metricsTag, positionPtr)) position = Module.HEAP32[positionPtr / 4];
		Module.stackRestore(sp);
		return position;
	}
	/**
	* Fetches metrics value corresponding to `metricsTag` from the font, and
	* synthesizes a value if the value is missing in the font.
	*
	* @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
	* @returns The metrics value.
	*/
	getMetricPositionWithFallback(metricsTag) {
		const sp = Module.stackSave();
		const positionPtr = Module.stackAlloc(4);
		exports.hb_ot_metrics_get_position_with_fallback(this.ptr, metricsTag, positionPtr);
		const position = Module.HEAP32[positionPtr / 4];
		Module.stackRestore(sp);
		return position;
	}
	/**
	* Fetches metrics value corresponding to `metricsTag` from the font with the
	* current font variation settings applied.
	*
	* @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
	* @returns The requested metric value.
	*/
	getMetricVariation(metricsTag) {
		return exports.hb_ot_metrics_get_variation(this.ptr, metricsTag);
	}
	/**
	* Fetches horizontal metrics value corresponding to `metricsTag` from the
	* font with the current font variation settings applied.
	*
	* @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
	* @returns The requested metric value.
	*/
	getMetricXVariation(metricsTag) {
		return exports.hb_ot_metrics_get_x_variation(this.ptr, metricsTag);
	}
	/**
	* Fetches vertical metrics value corresponding to `metricsTag` from the font
	* with the current font variation settings applied.
	*
	* @param metricsTag {@link MetricsTag} of metrics value you like to fetch.
	* @returns The requested metric value.
	*/
	getMetricYVariation(metricsTag) {
		return exports.hb_ot_metrics_get_y_variation(this.ptr, metricsTag);
	}
};
//#endregion
//#region src/font-funcs.ts
/**
* An object representing {@link https://harfbuzz.github.io/harfbuzz-hb-font.html | HarfBuzz font functions}.
* Font functions define the methods used by a Font for lower-level queries
* like glyph advances and extents. HarfBuzz provides built-in default
* implementations which can be selectively overridden.
*/
var FontFuncs = class {
	constructor() {
		this.ptr = exports.hb_font_funcs_create();
		track(this, exports.hb_font_funcs_destroy);
	}
	/**
	* Set the font's glyph extents function.
	* @param func The callback receives a Font and glyph ID. It should return
	* an object with xBearing, yBearing, width, and height, or undefined on failure.
	*/
	setGlyphExtentsFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, glyph, extentsPtr, user_data) => {
			const extents = func(new Font(fontPtr), glyph);
			if (extents) {
				Module.HEAP32[extentsPtr / 4] = extents.xBearing;
				Module.HEAP32[extentsPtr / 4 + 1] = extents.yBearing;
				Module.HEAP32[extentsPtr / 4 + 2] = extents.width;
				Module.HEAP32[extentsPtr / 4 + 3] = extents.height;
				return 1;
			}
			return 0;
		}, "ippipp");
		exports.hb_font_funcs_set_glyph_extents_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's glyph from name function.
	* @param func The callback receives a Font and glyph name. It should return
	* the glyph ID, or undefined on failure.
	*/
	setGlyphFromNameFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, namePtr, len, glyphPtr, user_data) => {
			const glyph = func(new Font(fontPtr), utf8_ptr_to_string(namePtr, len));
			if (glyph) {
				Module.HEAPU32[glyphPtr / 4] = glyph;
				return 1;
			}
			return 0;
		}, "ipppipp");
		exports.hb_font_funcs_set_glyph_from_name_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's glyph horizontal advance function.
	* @param func The callback receives a Font and glyph ID. It should return
	* the horizontal advance of the glyph.
	*/
	setGlyphHAdvanceFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, glyph, user_data) => {
			return func(new Font(fontPtr), glyph);
		}, "ippip");
		exports.hb_font_funcs_set_glyph_h_advance_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's glyph vertical advance function.
	* @param func The callback receives a Font and glyph ID. It should return
	* the vertical advance of the glyph.
	*/
	setGlyphVAdvanceFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, glyph, user_data) => {
			return func(new Font(fontPtr), glyph);
		}, "ippip");
		exports.hb_font_funcs_set_glyph_v_advance_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's glyph horizontal origin function.
	* @param func The callback receives a Font and glyph ID. It should return
	* the [x, y] horizontal origin of the glyph, or undefined on failure.
	*/
	setGlyphHOriginFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, glyph, xPtr, yPtr, user_data) => {
			const origin = func(new Font(fontPtr), glyph);
			if (origin) {
				Module.HEAP32[xPtr / 4] = origin[0];
				Module.HEAP32[yPtr / 4] = origin[1];
				return 1;
			}
			return 0;
		}, "ippippp");
		exports.hb_font_funcs_set_glyph_h_origin_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's glyph vertical origin function.
	* @param func The callback receives a Font and glyph ID. It should return
	* the [x, y] vertical origin of the glyph, or undefined on failure.
	*/
	setGlyphVOriginFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, glyph, xPtr, yPtr, user_data) => {
			const origin = func(new Font(fontPtr), glyph);
			if (origin) {
				Module.HEAP32[xPtr / 4] = origin[0];
				Module.HEAP32[yPtr / 4] = origin[1];
				return 1;
			}
			return 0;
		}, "ippippp");
		exports.hb_font_funcs_set_glyph_v_origin_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's glyph horizontal kerning function.
	* @param func The callback receives a Font, first glyph ID, and second glyph ID.
	* It should return the horizontal kerning of the glyphs.
	*/
	setGlyphHKerningFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, firstGlyph, secondGlyph, user_data) => {
			return func(new Font(fontPtr), firstGlyph, secondGlyph);
		}, "ippiip");
		exports.hb_font_funcs_set_glyph_h_kerning_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's glyph name function.
	* @param func The callback receives a Font and glyph ID. It should return
	* the name of the glyph, or undefined on failure.
	*/
	setGlyphNameFunc(func) {
		const utf8Encoder = new TextEncoder();
		const funcPtr = Module.addFunction((fontPtr, font_data, glyph, namePtr, size, user_data) => {
			const name = func(new Font(fontPtr), glyph);
			if (name) {
				utf8Encoder.encodeInto(name, Module.HEAPU8.subarray(namePtr, namePtr + size));
				return 1;
			}
			return 0;
		}, "ippipip");
		exports.hb_font_funcs_set_glyph_name_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's nominal glyph function.
	* @param func The callback receives a Font and unicode code point. It should
	* return the nominal glyph of the unicode, or undefined on failure.
	*/
	setNominalGlyphFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, unicode, glyphPtr, user_data) => {
			const glyph = func(new Font(fontPtr), unicode);
			if (glyph) {
				Module.HEAPU32[glyphPtr / 4] = glyph;
				return 1;
			}
			return 0;
		}, "ippipp");
		exports.hb_font_funcs_set_nominal_glyph_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's variation glyph function.
	* @param func The callback receives a Font, unicode code point, and variation
	* selector. It should return the variation glyph, or undefined on failure.
	*/
	setVariationGlyphFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, unicode, variationSelector, glyphPtr, user_data) => {
			const glyph = func(new Font(fontPtr), unicode, variationSelector);
			if (glyph) {
				Module.HEAPU32[glyphPtr / 4] = glyph;
				return 1;
			}
			return 0;
		}, "ippiipp");
		exports.hb_font_funcs_set_variation_glyph_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's horizontal extents function.
	* @param func The callback receives a Font. It should return an object with
	* ascender, descender, and lineGap, or undefined on failure.
	*/
	setFontHExtentsFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, extentsPtr, user_data) => {
			const extents = func(new Font(fontPtr));
			if (extents) {
				Module.HEAP32[extentsPtr / 4] = extents.ascender;
				Module.HEAP32[extentsPtr / 4 + 1] = extents.descender;
				Module.HEAP32[extentsPtr / 4 + 2] = extents.lineGap;
				return 1;
			}
			return 0;
		}, "ipppp");
		exports.hb_font_funcs_set_font_h_extents_func(this.ptr, funcPtr, 0, 0);
	}
	/**
	* Set the font's vertical extents function.
	* @param func The callback receives a Font. It should return an object with
	* ascender, descender, and lineGap, or undefined on failure.
	*/
	setFontVExtentsFunc(func) {
		const funcPtr = Module.addFunction((fontPtr, font_data, extentsPtr, user_data) => {
			const extents = func(new Font(fontPtr));
			if (extents) {
				Module.HEAP32[extentsPtr / 4] = extents.ascender;
				Module.HEAP32[extentsPtr / 4 + 1] = extents.descender;
				Module.HEAP32[extentsPtr / 4 + 2] = extents.lineGap;
				return 1;
			}
			return 0;
		}, "ipppp");
		exports.hb_font_funcs_set_font_v_extents_func(this.ptr, funcPtr, 0, 0);
	}
};
//#endregion
//#region src/paint-funcs.ts
function decode_color_line(colorLinePtr) {
	const extend = exports.hb_color_line_get_extend(colorLinePtr);
	const colorStops = [];
	const sp = Module.stackSave();
	const countPtr = Module.stackAlloc(4);
	const stopsPtr = Module.stackAlloc(1536);
	let startOffset = 0;
	let count = 128;
	while (count === 128) {
		Module.HEAPU32[countPtr / 4] = count;
		exports.hb_color_line_get_color_stops(colorLinePtr, startOffset, countPtr, stopsPtr);
		count = Module.HEAPU32[countPtr / 4];
		for (let i = 0; i < count; i++) {
			const o = (stopsPtr + i * 12) / 4;
			colorStops.push({
				offset: Module.HEAPF32[o],
				isForeground: Module.HEAPU32[o + 1] !== 0,
				color: color_from_int(Module.HEAPU32[o + 2])
			});
		}
		startOffset += count;
	}
	Module.stackRestore(sp);
	return {
		extend,
		colorStops
	};
}
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
var PaintFuncs = class {
	constructor() {
		this.funcPtrs = [];
		this.userDataPtrs = [];
		this.ptr = exports.hb_paint_funcs_create();
		const ptr = this.ptr;
		const funcPtrs = this.funcPtrs;
		const userDataPtrs = this.userDataPtrs;
		registry.register(this, () => {
			exports.hb_paint_funcs_destroy(ptr);
			for (const ptr of funcPtrs) Module.removeFunction(ptr);
			for (const ptr of userDataPtrs) remove_callback_data_pointer(ptr);
		});
	}
	/**
	* Sets the push-transform callback on the paint functions object.
	* @param func The push-transform callback.
	* @param userData Data to pass to `func`.
	*/
	setPushTransformFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, xx, yx, xy, yy, dx, dy, user) => func(xx, yx, xy, yy, dx, dy, get_callback_data(paintData), get_callback_data(user)), "viiffffffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_push_transform_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the pop-transform callback on the paint functions object.
	* @param func The pop-transform callback.
	* @param userData Data to pass to `func`.
	*/
	setPopTransformFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, user) => func(get_callback_data(paintData), get_callback_data(user)), "viii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_pop_transform_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the color-glyph callback on the paint functions object.
	* @param func The color-glyph callback.
	* @param userData Data to pass to `func`.
	*/
	setColorGlyphFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, glyph, fontPtr, user) => func(glyph, new Font(fontPtr), get_callback_data(paintData), get_callback_data(user)) ? 1 : 0, "iiiiii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_color_glyph_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the push-clip-glyph callback on the paint functions object.
	* @param func The push-clip-glyph callback.
	* @param userData Data to pass to `func`.
	*/
	setPushClipGlyphFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, glyph, fontPtr, user) => func(glyph, new Font(fontPtr), get_callback_data(paintData), get_callback_data(user)), "viiiii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_push_clip_glyph_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the push-clip-rectangle callback on the paint functions object.
	* @param func The push-clip-rectangle callback.
	* @param userData Data to pass to `func`.
	*/
	setPushClipRectangleFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, xmin, ymin, xmax, ymax, user) => func(xmin, ymin, xmax, ymax, get_callback_data(paintData), get_callback_data(user)), "viiffffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_push_clip_rectangle_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the pop-clip callback on the paint functions object.
	* @param func The pop-clip callback.
	* @param userData Data to pass to `func`.
	*/
	setPopClipFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, user) => func(get_callback_data(paintData), get_callback_data(user)), "viii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_pop_clip_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the paint-color callback on the paint functions object.
	* @param func The paint-color callback.
	* @param userData Data to pass to `func`.
	*/
	setColorFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, isForeground, color, user) => func(isForeground !== 0, color_from_int(color), get_callback_data(paintData), get_callback_data(user)), "viiiii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_color_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the paint-image callback on the paint functions object.
	* @param func The paint-image callback.
	* @param userData Data to pass to `func`.
	*/
	setImageFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, blob, width, height, format, slant, extentsPtr, user) => {
			const length = exports.hb_blob_get_length(blob);
			const dataPtr = exports.hb_blob_get_data(blob, 0);
			const image = Module.HEAPU8.subarray(dataPtr, dataPtr + length);
			let extents;
			if (extentsPtr) extents = {
				xBearing: Module.HEAP32[extentsPtr / 4],
				yBearing: Module.HEAP32[extentsPtr / 4 + 1],
				width: Module.HEAP32[extentsPtr / 4 + 2],
				height: Module.HEAP32[extentsPtr / 4 + 3]
			};
			return func(image, width, height, hb_untag(format), extents, get_callback_data(paintData), get_callback_data(user)) ? 1 : 0;
		}, "iiiiiiifii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_image_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the linear-gradient callback on the paint functions object.
	* @param func The linear-gradient callback.
	* @param userData Data to pass to `func`.
	*/
	setLinearGradientFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, colorLine, x0, y0, x1, y1, x2, y2, user) => func(decode_color_line(colorLine), x0, y0, x1, y1, x2, y2, get_callback_data(paintData), get_callback_data(user)), "viiiffffffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_linear_gradient_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the radial-gradient callback on the paint functions object.
	* @param func The radial-gradient callback.
	* @param userData Data to pass to `func`.
	*/
	setRadialGradientFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, colorLine, x0, y0, r0, x1, y1, r1, user) => func(decode_color_line(colorLine), x0, y0, r0, x1, y1, r1, get_callback_data(paintData), get_callback_data(user)), "viiiffffffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_radial_gradient_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the sweep-gradient callback on the paint functions object.
	* @param func The sweep-gradient callback.
	* @param userData Data to pass to `func`.
	*/
	setSweepGradientFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, colorLine, x0, y0, startAngle, endAngle, user) => func(decode_color_line(colorLine), x0, y0, startAngle, endAngle, get_callback_data(paintData), get_callback_data(user)), "viiiffffi");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_sweep_gradient_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the push-group callback on the paint functions object.
	* @param func The push-group callback.
	* @param userData Data to pass to `func`.
	*/
	setPushGroupFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, user) => func(get_callback_data(paintData), get_callback_data(user)), "viii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_push_group_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the pop-group callback on the paint functions object.
	* @param func The pop-group callback.
	* @param userData Data to pass to `func`.
	*/
	setPopGroupFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, mode, user) => func(mode, get_callback_data(paintData), get_callback_data(user)), "viiii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_pop_group_func(this.ptr, funcPtr, userDataPtr, 0);
	}
	/**
	* Sets the custom-palette-color callback on the paint functions object.
	* @param func The custom-palette-color callback.
	* @param userData Data to pass to `func`.
	*/
	setCustomPaletteColorFunc(func, userData) {
		const userDataPtr = register_callback_data_pointer(userData);
		this.userDataPtrs.push(userDataPtr);
		const funcPtr = Module.addFunction((funcs, paintData, colorIndex, colorPtr, user) => {
			const color = func(colorIndex, get_callback_data(paintData), get_callback_data(user));
			if (color !== void 0) {
				Module.HEAPU32[colorPtr / 4] = color_to_int(color);
				return 1;
			}
			return 0;
		}, "iiiiii");
		this.funcPtrs.push(funcPtr);
		exports.hb_paint_funcs_set_custom_palette_color_func(this.ptr, funcPtr, userDataPtr, 0);
	}
};
//#endregion
//#region src/buffer.ts
const BufferContentType = {
	INVALID: 0,
	UNICODE: 1,
	GLYPHS: 2
};
const BufferSerializeFlag = {
	DEFAULT: 0,
	NO_CLUSTERS: 1,
	NO_POSITIONS: 2,
	NO_GLYPH_NAMES: 4,
	GLYPH_EXTENTS: 8,
	GLYPH_FLAGS: 16,
	NO_ADVANCES: 32,
	DEFINED: 63
};
const BufferFlag = {
	DEFAULT: 0,
	BOT: 1,
	EOT: 2,
	PRESERVE_DEFAULT_IGNORABLES: 4,
	REMOVE_DEFAULT_IGNORABLES: 8,
	DO_NOT_INSERT_DOTTED_CIRCLE: 16,
	VERIFY: 32,
	PRODUCE_UNSAFE_TO_CONCAT: 64,
	PRODUCE_SAFE_TO_INSERT_TATWEEL: 128,
	DEFINED: 255
};
const Direction = {
	INVALID: 0,
	LTR: 4,
	RTL: 5,
	TTB: 6,
	BTT: 7
};
const ClusterLevel = {
	MONOTONE_GRAPHEMES: 0,
	MONOTONE_CHARACTERS: 1,
	CHARACTERS: 2,
	GRAPHEMES: 3,
	DEFAULT: 0
};
const BufferSerializeFormat = {
	INVALID: 0,
	TEXT: hb_tag("TEXT"),
	JSON: hb_tag("JSON")
};
/**
* An object representing a {@link https://harfbuzz.github.io/harfbuzz-hb-buffer.html | HarfBuzz buffer}.
* A buffer holds the input text and its properties before shaping, and the
* output glyphs and their information after shaping.
*/
var Buffer = class Buffer {
	/**
	* @param existingPtr @internal Wrap an existing buffer pointer.
	*/
	constructor(existingPtr) {
		if (existingPtr != void 0) this.ptr = exports.hb_buffer_reference(existingPtr);
		else this.ptr = exports.hb_buffer_create();
		track(this, exports.hb_buffer_destroy);
	}
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
	add(codePoint, cluster) {
		exports.hb_buffer_add(this.ptr, codePoint, cluster);
	}
	/**
	* Add text to the buffer.
	* @param text Text to be added to the buffer.
	* @param itemOffset The offset of the first character to add to the buffer.
	* @param itemLength The number of characters to add to the buffer, or omit for the end of text.
	*/
	addText(text, itemOffset = 0, itemLength) {
		const str = string_to_utf16_ptr(text);
		exports.hb_buffer_add_utf16(this.ptr, str.ptr, str.length, itemOffset, itemLength ?? str.length);
		str.free();
	}
	/**
	* Add code points to the buffer.
	* @param codePoints Array of code points to be added to the buffer.
	* @param itemOffset The offset of the first code point to add to the buffer.
	* @param itemLength The number of code points to add to the buffer, or omit for the end of the array.
	*/
	addCodePoints(codePoints, itemOffset = 0, itemLength) {
		const codePointsPtr = exports.malloc(codePoints.length * 4);
		Module.HEAPU32.subarray(codePointsPtr / 4, codePointsPtr / 4 + codePoints.length).set(codePoints);
		exports.hb_buffer_add_codepoints(this.ptr, codePointsPtr, codePoints.length, itemOffset, itemLength ?? codePoints.length);
		exports.free(codePointsPtr);
	}
	/**
	* Set buffer script, language and direction.
	*
	* This needs to be done before shaping.
	*/
	guessSegmentProperties() {
		exports.hb_buffer_guess_segment_properties(this.ptr);
	}
	/**
	* Set buffer direction explicitly.
	* @param dir A {@link Direction} value.
	*/
	setDirection(dir) {
		exports.hb_buffer_set_direction(this.ptr, dir);
	}
	/**
	* Set buffer flags explicitly.
	* @param flags A combination of {@link BufferFlag} values (OR them together).
	*/
	setFlags(flags) {
		exports.hb_buffer_set_flags(this.ptr, flags);
	}
	/**
	* Set buffer language explicitly.
	* @param language The buffer language
	*/
	setLanguage(language) {
		const str = string_to_ascii_ptr(language);
		exports.hb_buffer_set_language(this.ptr, exports.hb_language_from_string(str.ptr, -1));
		str.free();
	}
	/**
	* Set buffer script explicitly.
	* @param script The buffer script
	*/
	setScript(script) {
		const str = string_to_ascii_ptr(script);
		exports.hb_buffer_set_script(this.ptr, exports.hb_script_from_string(str.ptr, -1));
		str.free();
	}
	/**
	* Set the HarfBuzz clustering level.
	*
	* Affects the cluster values returned from shaping.
	* @param level A {@link ClusterLevel} value. See the HarfBuzz manual chapter on Clusters.
	*/
	setClusterLevel(level) {
		exports.hb_buffer_set_cluster_level(this.ptr, level);
	}
	/** Reset the buffer to its initial status. */
	reset() {
		exports.hb_buffer_reset(this.ptr);
	}
	/**
	* Similar to reset(), but does not clear the Unicode functions and the
	* replacement code point.
	*/
	clearContents() {
		exports.hb_buffer_clear_contents(this.ptr);
	}
	/**
	* Set message func.
	* @param func The function to set. It receives the buffer, font, and message
	* string as arguments. Returning false will skip this shaping step and move
	* to the next one.
	*/
	setMessageFunc(func) {
		const traceFunc = (bufferPtr, fontPtr, messagePtr, user_data) => {
			const message = utf8_ptr_to_string(messagePtr);
			return func(new Buffer(bufferPtr), new Font(fontPtr), message) ? 1 : 0;
		};
		const traceFuncPtr = Module.addFunction(traceFunc, "iiiii");
		exports.hb_buffer_set_message_func(this.ptr, traceFuncPtr, 0, 0);
	}
	/**
	* Get the the number of items in the buffer.
	* @returns The buffer length.
	*/
	getLength() {
		return exports.hb_buffer_get_length(this.ptr);
	}
	/**
	* Get the glyph information from the buffer.
	* @returns An array of {@link GlyphInfo} objects.
	*/
	getGlyphInfos() {
		const infosPtr = exports.hb_buffer_get_glyph_infos(this.ptr, 0);
		const infosArray = Module.HEAPU32.subarray(infosPtr / 4, infosPtr / 4 + this.getLength() * 5);
		const infos = [];
		for (let i = 0; i < infosArray.length; i += 5) infos.push({
			codepoint: infosArray[i],
			cluster: infosArray[i + 2],
			flags: exports.hb_glyph_info_get_glyph_flags(infosPtr + i * 4)
		});
		return infos;
	}
	/**
	* Get the glyph positions from the buffer.
	* @returns An array of {@link GlyphPosition} objects.
	*/
	getGlyphPositions() {
		const positionsPtr32 = exports.hb_buffer_get_glyph_positions(this.ptr, 0) / 4;
		if (positionsPtr32 == 0) return [];
		const positionsArray = Module.HEAP32.subarray(positionsPtr32, positionsPtr32 + this.getLength() * 5);
		const positions = [];
		for (let i = 0; i < positionsArray.length; i += 5) positions.push({
			xAdvance: positionsArray[i],
			yAdvance: positionsArray[i + 1],
			xOffset: positionsArray[i + 2],
			yOffset: positionsArray[i + 3]
		});
		return positions;
	}
	/**
	* Get the glyph information and positions from the buffer.
	* @returns The glyph information and positions.
	*
	* The glyph information is returned as an array of objects with the
	* properties from getGlyphInfos and getGlyphPositions combined.
	*/
	getGlyphInfosAndPositions() {
		const infosPtr = exports.hb_buffer_get_glyph_infos(this.ptr, 0);
		const infosArray = Module.HEAPU32.subarray(infosPtr / 4, infosPtr / 4 + this.getLength() * 5);
		const positionsPtr32 = exports.hb_buffer_get_glyph_positions(this.ptr, 0) / 4;
		const positionsArray = positionsPtr32 ? Module.HEAP32.subarray(positionsPtr32, positionsPtr32 + this.getLength() * 5) : void 0;
		const out = [];
		for (let i = 0; i < infosArray.length; i += 5) {
			const info = {
				codepoint: infosArray[i],
				cluster: infosArray[i + 2],
				flags: exports.hb_glyph_info_get_glyph_flags(infosPtr + i * 4)
			};
			for (const [name, idx] of [
				["mask", 1],
				["var1", 3],
				["var2", 4]
			]) Object.defineProperty(info, name, {
				value: infosArray[i + idx],
				enumerable: false
			});
			if (positionsArray) {
				info.xAdvance = positionsArray[i];
				info.yAdvance = positionsArray[i + 1];
				info.xOffset = positionsArray[i + 2];
				info.yOffset = positionsArray[i + 3];
				Object.defineProperty(info, "var", {
					value: positionsArray[i + 4],
					enumerable: false
				});
			}
			out.push(info);
		}
		return out;
	}
	/**
	* Update the glyph positions in the buffer.
	* WARNING: Do not use unless you know what you are doing.
	*/
	updateGlyphPositions(positions) {
		const positionsPtr32 = exports.hb_buffer_get_glyph_positions(this.ptr, 0) / 4;
		if (positionsPtr32 == 0) return;
		const len = Math.min(positions.length, this.getLength());
		const positionsArray = Module.HEAP32.subarray(positionsPtr32, positionsPtr32 + len * 5);
		for (let i = 0; i < len; i++) {
			positionsArray[i * 5] = positions[i].xAdvance;
			positionsArray[i * 5 + 1] = positions[i].yAdvance;
			positionsArray[i * 5 + 2] = positions[i].xOffset;
			positionsArray[i * 5 + 3] = positions[i].yOffset;
		}
	}
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
	serialize(options = {}) {
		let { font, start = 0, end, format = BufferSerializeFormat.TEXT, flags = 0 } = options;
		const sp = Module.stackSave();
		const endPos = end ?? this.getLength();
		const bufLen = 32 * 1024;
		const bufPtr = exports.malloc(bufLen);
		const bufConsumedPtr = Module.stackAlloc(4);
		let result = "";
		while (start < endPos) {
			start += exports.hb_buffer_serialize(this.ptr, start, endPos, bufPtr, bufLen, bufConsumedPtr, font ? font.ptr : 0, format, flags);
			const bufConsumed = Module.HEAPU32[bufConsumedPtr / 4];
			if (bufConsumed == 0) break;
			result += utf8_ptr_to_string(bufPtr, bufConsumed);
		}
		exports.free(bufPtr);
		Module.stackRestore(sp);
		return result;
	}
	/**
	* Return the buffer content type.
	*
	* @returns The buffer content type as a {@link BufferContentType} value.
	*/
	getContentType() {
		return exports.hb_buffer_get_content_type(this.ptr);
	}
};
//#endregion
//#region src/feature.ts
/**
* A {@link https://harfbuzz.github.io/harfbuzz-hb-common.html#hb-feature-t | HarfBuzz feature}.
*
* The structure that holds information about requested feature application.
* The feature will be applied with the given value to all glyphs which are in
* clusters between {@link Feature.start} (inclusive) and {@link Feature.end}
* (exclusive). Setting `start` to `0` and `end` to `0xffffffff` specifies that
* the feature always applies to the entire buffer.
*/
var Feature = class Feature {
	static {
		this.GLOBAL_START = 0;
	}
	static {
		this.GLOBAL_END = 4294967295;
	}
	constructor(tag, value = 1, start = Feature.GLOBAL_START, end = Feature.GLOBAL_END) {
		this.tag = tag;
		this.value = value;
		this.start = start;
		this.end = end;
	}
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
	static fromString(str) {
		const sp = Module.stackSave();
		const featurePtr = Module.stackAlloc(16);
		const strPtr = string_to_ascii_ptr(str);
		let feature;
		if (exports.hb_feature_from_string(strPtr.ptr, -1, featurePtr)) feature = new Feature(hb_untag(Module.HEAPU32[featurePtr / 4]), Module.HEAPU32[featurePtr / 4 + 1], Module.HEAPU32[featurePtr / 4 + 2], Module.HEAPU32[featurePtr / 4 + 3]);
		strPtr.free();
		Module.stackRestore(sp);
		return feature;
	}
	/**
	* Converts the feature to a string in the format understood by
	* {@link Feature.fromString}.
	*
	* Note that the feature value will be omitted if it is `1`, but the string
	* won't include any whitespace.
	*
	* @returns The feature string.
	*/
	toString() {
		const sp = Module.stackSave();
		const featurePtr = Module.stackAlloc(16);
		this.writeTo(featurePtr);
		const bufLen = 128;
		const bufPtr = Module.stackAlloc(bufLen);
		exports.hb_feature_to_string(featurePtr, bufPtr, bufLen);
		const result = utf8_ptr_to_string(bufPtr);
		Module.stackRestore(sp);
		return result;
	}
	/** @internal Write this feature into the given hb_feature_t pointer. */
	writeTo(ptr) {
		Module.HEAPU32[ptr / 4] = hb_tag(this.tag);
		Module.HEAPU32[ptr / 4 + 1] = this.value;
		Module.HEAPU32[ptr / 4 + 2] = this.start;
		Module.HEAPU32[ptr / 4 + 3] = this.end;
	}
};
//#endregion
//#region src/variation.ts
/**
* A {@link https://harfbuzz.github.io/harfbuzz-hb-common.html#hb-variation-t | HarfBuzz variation}.
*
* Data type for holding variation data. Registered OpenType variation-axis
* tags are listed in
* {@link https://docs.microsoft.com/en-us/typography/opentype/spec/dvaraxisreg | OpenType Axis Tag Registry}.
*/
var Variation = class Variation {
	constructor(tag, value = 0) {
		this.tag = tag;
		this.value = value;
	}
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
	static fromString(str) {
		const sp = Module.stackSave();
		const variationPtr = Module.stackAlloc(8);
		const strPtr = string_to_ascii_ptr(str);
		let variation;
		if (exports.hb_variation_from_string(strPtr.ptr, -1, variationPtr)) variation = new Variation(hb_untag(Module.HEAPU32[variationPtr / 4]), Module.HEAPF32[variationPtr / 4 + 1]);
		strPtr.free();
		Module.stackRestore(sp);
		return variation;
	}
	/**
	* Converts the variation to a string in the format understood by
	* {@link Variation.fromString}.
	*
	* Note that the string won't include any whitespace.
	*
	* @returns The variation string.
	*/
	toString() {
		const sp = Module.stackSave();
		const variationPtr = Module.stackAlloc(8);
		this.writeTo(variationPtr);
		const bufLen = 128;
		const bufPtr = Module.stackAlloc(bufLen);
		exports.hb_variation_to_string(variationPtr, bufPtr, bufLen);
		const result = utf8_ptr_to_string(bufPtr);
		Module.stackRestore(sp);
		return result;
	}
	/** @internal Write this variation into the given hb_variation_t pointer. */
	writeTo(ptr) {
		Module.HEAPU32[ptr / 4] = hb_tag(this.tag);
		Module.HEAPF32[ptr / 4 + 1] = this.value;
	}
};
//#endregion
//#region src/shape.ts
const TracePhase = {
	DONT_STOP: 0,
	GSUB: 1,
	GPOS: 2
};
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
function shape(font, buffer, features) {
	const featuresLen = features?.length ?? 0;
	const sp = Module.stackSave();
	let featuresPtr = 0;
	if (featuresLen) {
		featuresPtr = Module.stackAlloc(16 * featuresLen);
		features.forEach((feature, i) => {
			feature.writeTo(featuresPtr + i * 16);
		});
	}
	exports.hb_shape(font.ptr, buffer.ptr, featuresPtr, featuresLen);
	Module.stackRestore(sp);
}
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
function shapeWithTrace(font, buffer, features, stop_at, stop_phase) {
	const trace = [];
	let currentPhase = TracePhase.DONT_STOP;
	let stopping = false;
	buffer.setMessageFunc((buffer, font, message) => {
		if (message.startsWith("start table GSUB")) currentPhase = TracePhase.GSUB;
		else if (message.startsWith("start table GPOS")) currentPhase = TracePhase.GPOS;
		if (currentPhase != stop_phase) stopping = false;
		if (stop_phase != TracePhase.DONT_STOP && currentPhase == stop_phase && message.startsWith("end lookup " + stop_at)) stopping = true;
		if (stopping) return false;
		const traceBuf = buffer.serialize({
			font,
			format: BufferSerializeFormat.JSON,
			flags: BufferSerializeFlag.NO_GLYPH_NAMES
		});
		trace.push({
			m: message,
			t: JSON.parse(traceBuf),
			glyphs: buffer.getContentType() == BufferContentType.GLYPHS
		});
		return true;
	});
	shape(font, buffer, features);
	return trace;
}
/**
* Return the HarfBuzz version.
* @returns An object with major, minor, and micro version numbers.
*/
function version() {
	const sp = Module.stackSave();
	const versionPtr = Module.stackAlloc(12);
	exports.hb_version(versionPtr, versionPtr + 4, versionPtr + 8);
	const ver = {
		major: Module.HEAPU32[versionPtr / 4],
		minor: Module.HEAPU32[(versionPtr + 4) / 4],
		micro: Module.HEAPU32[(versionPtr + 8) / 4]
	};
	Module.stackRestore(sp);
	return ver;
}
/**
* Return the HarfBuzz version as a string.
* @returns A version string in the form "major.minor.micro".
*/
function versionString() {
	return utf8_ptr_to_string(exports.hb_version_string());
}
/**
* Convert an OpenType script tag to HarfBuzz script (ISO 15924).
* @param tag The tag to convert.
* @returns The script.
*/
function otTagToScript(tag) {
	const hbTag = hb_tag(tag);
	return hb_untag(exports.hb_ot_tag_to_script(hbTag));
}
/**
* Convert an OpenType language tag to HarfBuzz language (BCP 47).
* @param tag The tag to convert.
* @returns The language.
*/
function otTagToLanguage(tag) {
	const hbTag = hb_tag(tag);
	return language_to_string(exports.hb_ot_tag_to_language(hbTag));
}
/** https://harfbuzz.github.io/harfbuzz-hb-ot-layout.html#HB-OT-MAX-TAGS-PER-LANGUAGE:CAPS */
const HB_OT_MAX_TAGS_PER_LANGUAGE = 3;
/** https://harfbuzz.github.io/harfbuzz-hb-ot-layout.html#HB-OT-MAX-TAGS-PER-SCRIPT:CAPS */
const HB_OT_MAX_TAGS_PER_SCRIPT = 3;
/**
* Convert a HarfBuzz script (ISO 15924) and a HarfBuzz language (BCP 47) to OpenType script tags and OpenType language tags.
* @param script A HarfBuzz script to convert.
* @param language A HarfBuzz language to convert.
* @returns An object with the OpenType script tags and the OpenType language tags.
*/
function otTagsFromScriptAndLanguage(script, language) {
	const sp = Module.stackSave();
	const scriptStr = string_to_ascii_ptr(script);
	const languageStr = string_to_ascii_ptr(language);
	const scriptCountPtr = Module.stackAlloc(4);
	Module.HEAPU32[scriptCountPtr / 4] = HB_OT_MAX_TAGS_PER_SCRIPT;
	const scriptTagsPtr = Module.stackAlloc(HB_OT_MAX_TAGS_PER_SCRIPT * 4);
	const languageCountPtr = Module.stackAlloc(4);
	Module.HEAPU32[languageCountPtr / 4] = HB_OT_MAX_TAGS_PER_LANGUAGE;
	const languageTagsPtr = Module.stackAlloc(HB_OT_MAX_TAGS_PER_LANGUAGE * 4);
	exports.hb_ot_tags_from_script_and_language(exports.hb_script_from_string(scriptStr.ptr, -1), exports.hb_language_from_string(languageStr.ptr, -1), scriptCountPtr, scriptTagsPtr, languageCountPtr, languageTagsPtr);
	scriptStr.free();
	languageStr.free();
	const scriptTags = Module.HEAPU32.subarray(scriptTagsPtr / 4, scriptTagsPtr / 4 + Module.HEAPU32[scriptCountPtr / 4]);
	const languageTags = Module.HEAPU32.subarray(languageTagsPtr / 4, languageTagsPtr / 4 + Module.HEAPU32[languageCountPtr / 4]);
	Module.stackRestore(sp);
	return {
		scriptTags: [...scriptTags].map(hb_untag),
		languageTags: [...languageTags].map(hb_untag)
	};
}
/**
* Convert an OpenType script tag and an OpenType language tag to a HarfBuzz script (ISO 15924) and a HarfBuzz language (BCP 47).
* @param scriptTag An OpenType script tag.
* @param languageTag An OpenType language tag.
* @returns An object with the HarfBuzz script and the HarfBuzz language.
*/
function otTagsToScriptAndLanguage(scriptTag, languageTag) {
	const sp = Module.stackSave();
	const scriptPtr = Module.stackAlloc(4);
	const languagePtr = Module.stackAlloc(4);
	exports.hb_ot_tags_to_script_and_language(hb_tag(scriptTag), hb_tag(languageTag), scriptPtr, languagePtr);
	const script = Module.HEAPU32[scriptPtr / 4];
	const language = Module.HEAPU32[languagePtr / 4];
	Module.stackRestore(sp);
	return {
		script: hb_untag(script),
		language: language_to_string(language)
	};
}
//#endregion
//#region src/index.ts
init(await createHarfBuzz());
//#endregion
export { AxisFlags, Blob, Buffer, BufferContentType, BufferFlag, BufferSerializeFlag, BufferSerializeFormat, ClusterLevel, ColorPaletteFlags, Direction, DrawFuncs, Face, Feature, Font, FontFuncs, GlyphClass, GlyphFlag, MetricsTag, PaintCompositeMode, PaintExtend, PaintFuncs, TracePhase, Variation, otTagToLanguage, otTagToScript, otTagsFromScriptAndLanguage, otTagsToScriptAndLanguage, shape, shapeWithTrace, version, versionString };
