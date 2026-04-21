const ETF_VERSION = 131;

// Tag bytes from https://www.erlang.org/doc/apps/erts/erl_ext_dist.html
const Tags = Object.freeze({
  NEW_FLOAT_EXT: 70,
  BIT_BINARY_EXT: 77,
  NEW_PID_EXT: 88,
  NEW_PORT_EXT: 89,
  NEWER_REFERENCE_EXT: 90,
  SMALL_INTEGER_EXT: 97,
  INTEGER_EXT: 98,
  FLOAT_EXT: 99,
  ATOM_EXT: 100,
  REFERENCE_EXT: 101,
  PORT_EXT: 102,
  PID_EXT: 103,
  SMALL_TUPLE_EXT: 104,
  LARGE_TUPLE_EXT: 105,
  NIL_EXT: 106,
  STRING_EXT: 107,
  LIST_EXT: 108,
  BINARY_EXT: 109,
  SMALL_BIG_EXT: 110,
  LARGE_BIG_EXT: 111,
  NEW_FUN_EXT: 112,
  EXPORT_EXT: 113,
  NEW_REFERENCE_EXT: 114,
  SMALL_ATOM_EXT: 115,
  MAP_EXT: 116,
  FUN_EXT: 117,
  ATOM_UTF8_EXT: 118,
  SMALL_ATOM_UTF8_EXT: 119,
  V4_PORT_EXT: 120,
});

// Internal type alias: all encode/decode helpers pass (DataView, index) and return the same
type DvI = [DataView, number];

class Tuple extends Array<unknown> {
  constructor(...elements: unknown[]) {
    super();
    this.push(...elements);
    if (elements.length) this.freeze();
  }

  freeze(): void {
    Object.freeze(this);
  }
}

/**
 * ETF (JustErlangMaps) — encoder/decoder for the Erlang External Term Format (ETF).
 */
class ETF {
  static readonly MAPS_AS_OBJECTS: number = 0b00001;
  static readonly IGNORE_INVALID_TERMS: number = 0b00010;
  static readonly BINARIES_AS_UINT8_ARRAYS: number = 0b00100;
  static readonly ATOMS_AS_STRINGS: number = 0b01000;
  static readonly NULL_AS_NIL: number = 0b10000;

  options: number;
  #encoder: TextEncoder;
  #decoder: TextDecoder;

  get mapsAsObjects(): boolean {
    return this.getOption(ETF.MAPS_AS_OBJECTS);
  }
  set mapsAsObjects(v: boolean) {
    this.setOption(ETF.MAPS_AS_OBJECTS, v);
  }

  get ignoreInvalidTerms(): boolean {
    return this.getOption(ETF.IGNORE_INVALID_TERMS);
  }
  set ignoreInvalidTerms(v: boolean) {
    this.setOption(ETF.IGNORE_INVALID_TERMS, v);
  }

  get binariesAsUint8Arrays(): boolean {
    return this.getOption(ETF.BINARIES_AS_UINT8_ARRAYS);
  }
  set binariesAsUint8Arrays(v: boolean) {
    this.setOption(ETF.BINARIES_AS_UINT8_ARRAYS, v);
  }

  get atomsAsStrings(): boolean {
    return this.getOption(ETF.ATOMS_AS_STRINGS);
  }
  set atomsAsStrings(v: boolean) {
    this.setOption(ETF.ATOMS_AS_STRINGS, v);
  }

  get nullAsNil(): boolean {
    return this.getOption(ETF.NULL_AS_NIL);
  }
  set nullAsNil(v: boolean) {
    this.setOption(ETF.NULL_AS_NIL, v);
  }

  constructor(options: number = 0) {
    this.options = options;
    this.#encoder = new TextEncoder();
    this.#decoder = new TextDecoder();
  }

  encode(value: unknown, initialBufferSize: number = 1000): ArrayBuffer {
    const dv = new DataView(new ArrayBuffer(initialBufferSize));
    dv.setUint8(0, ETF_VERSION);
    const [finalDv, i] = this.#encodeValue(value, dv, 1);
    return (finalDv.buffer as ArrayBuffer).slice(0, i);
  }

  decode(buffer: ArrayBuffer | DataView, pointer: number = 0): unknown {
    const dv = buffer instanceof DataView ? buffer : new DataView(buffer);
    if (dv.getUint8(pointer) !== ETF_VERSION) throw new Error("badarg");
    else return this.#decodeValue(dv, pointer + 1)[0];
  }

  getOption(option: number): boolean {
    return (this.options & option) != 0;
  }

  setOption(option: number, value: boolean): void {
    if (value) this.options |= option;
    else this.options &= ~option;
  }

  // This is a debug function
  toString(
    buffer: ArrayBuffer | DataView,
    erlangStyle: boolean = true,
  ): string {
    const dv = buffer instanceof DataView ? buffer : new DataView(buffer);
    const l = dv.byteLength;
    const bytes: number[] = [];
    for (let i = 0; i < l; i++) bytes[i] = dv.getUint8(i);
    const bytesStr = bytes.join(", ");
    if (erlangStyle) return `<<${bytesStr}>>`;
    else return `[${bytesStr}]`;
  }

  //============================================================================
  // Internal encoding functions
  //============================================================================
  #encodeValue(value: unknown, dv: DataView, i: number): DvI {
    if (value === null) return this.#encodeNull(dv, i);
    if (value === undefined)
      return this.#encodeValue(Symbol.for("undefined"), dv, i);
    if (typeof value === "number") return this.#encodeNumber(value, dv, i);
    if (typeof value === "bigint") return this.#encodeBigInt(value, dv, i);
    if (typeof value === "string") return this.#encodeString(value, dv, i);
    if (typeof value === "boolean") return this.#encodeBoolean(value, dv, i);
    if (typeof value === "symbol")
      return this.#encodeAtom(value.description!, dv, i);
    if (value instanceof Uint8Array) return this.#encodeBinary(value, dv, i);
    if (value instanceof Tuple) return this.#encodeTuple(value, dv, i);
    if (value instanceof Map) return this.#encodeMap(value, dv, i);
    if (Array.isArray(value)) return this.#encodeArray(value, dv, i);
    if (typeof value === "object")
      return this.#encodeObject(value as Record<string, unknown>, dv, i);
    throw new Error(`unable to encode value of type '${typeof value}'`);
  }

  #encodeNull(dv: DataView, i: number): DvI {
    if (this.nullAsNil) {
      dv = this.#getDataView(dv, i, 5);
      // SMALL_ATOM_UTF8_EXT(119=0x77) + len=3 + "nil" → [0x77, 0x03, 'n', 'i', 'l']
      dv.setUint32(i, 1996713577);
      dv.setUint8(i + 4, 108);
      return [dv, i + 5];
    } else {
      dv = this.#getDataView(dv, i, 6);
      // SMALL_ATOM_UTF8_EXT(119=0x77) + len=4 + "null" → [0x77, 0x04, 'n', 'u', 'l', 'l']
      dv.setUint32(i, 1996779125);
      dv.setUint16(i + 4, 27756);
      return [dv, i + 6];
    }
  }

  #encodeObject(obj: Record<string, unknown>, dv: DataView, i: number): DvI {
    dv = this.#getDataView(dv, i, 5);
    dv.setUint8(i, Tags.MAP_EXT);
    i += 1;
    const keys = Object.keys(obj);
    const l = keys.length;
    dv.setUint32(i, l);
    i += 4;
    for (let k = 0; k < l; k++) {
      const key = keys[k];
      [dv, i] = this.#encodeString(key, dv, i);
      [dv, i] = this.#encodeValue(obj[key], dv, i);
    }
    return [dv, i];
  }

  #encodeMap(map: Map<unknown, unknown>, dv: DataView, i: number): DvI {
    dv = this.#getDataView(dv, i, 5);
    dv.setUint8(i, Tags.MAP_EXT);
    i += 1;
    dv.setUint32(i, map.size);
    i += 4;
    for (const [key, value] of map) {
      [dv, i] = this.#encodeValue(key, dv, i);
      [dv, i] = this.#encodeValue(value, dv, i);
    }
    return [dv, i];
  }

  #encodeNumber(num: number, dv: DataView, i: number): DvI {
    if (Number.isInteger(num)) {
      if (num >= 0 && num <= 255) {
        dv = this.#getDataView(dv, i, 2);
        dv.setUint16(i, 24832 | num); // 24832 = SMALL_INTEGER_EXT(97) << 8
        return [dv, i + 2];
      } else if (num >= -2147483648 && num <= 2147483647) {
        dv = this.#getDataView(dv, i, 5);
        dv.setUint8(i, Tags.INTEGER_EXT);
        dv.setInt32(i + 1, num);
        return [dv, i + 5];
      } else {
        return this.#encodeBigInt(BigInt(num), dv, i);
      }
    } else {
      dv = this.#getDataView(dv, i, 9);
      dv.setUint8(i, Tags.NEW_FLOAT_EXT);
      dv.setFloat64(i + 1, num);
      return [dv, i + 9];
    }
  }

  #encodeBigInt(value: bigint, dv: DataView, i: number): DvI {
    // Get the sign
    const sign = value >= 0n ? 0 : 1;
    if (sign) value = -value;
    // Convert the value to a string to get its length
    const l = Math.ceil(value.toString(2).length / 8);
    // With the length we can check how many bytes we need for the length
    if (l <= 255) {
      dv = this.#getDataView(dv, i, 3 + l);
      // 28160 = SMALL_BIG_EXT(110) << 8
      dv.setUint16(i, 28160 | l);
      i += 2;
    } else {
      dv = this.#getDataView(dv, i, 6 + l);
      dv.setUint8(i, Tags.LARGE_BIG_EXT);
      i += 1;
      dv.setUint32(i, l);
      i += 4;
    }
    // Add the sign
    dv.setUint8(i, sign);
    i += 1;
    // Set all the bytes of the number
    for (let k = 0; k < l; k++) {
      dv.setUint8(i + k, Number((value >> BigInt(8 * k)) & 255n));
    }
    return [dv, i + l];
  }

  #encodeArray(arr: unknown[], dv: DataView, i: number): DvI {
    dv = this.#getDataView(dv, i, 5);
    dv.setUint8(i, Tags.LIST_EXT);
    i += 1;
    const l = arr.length;
    dv.setUint32(i, l);
    i += 4;
    for (let k = 0; k < l; k++) {
      [dv, i] = this.#encodeValue(arr[k], dv, i);
    }
    dv = this.#getDataView(dv, i, 1);
    dv.setUint8(i, Tags.NIL_EXT);
    return [dv, i + 1];
  }

  #encodeTuple(tuple: Tuple, dv: DataView, i: number): DvI {
    const l = tuple.length;
    if (l <= 255) {
      dv = this.#getDataView(dv, i, 2);
      // 26624 = SMALL_TUPLE_EXT(104) << 8
      dv.setUint16(i, 26624 | l);
      i += 2;
    } else {
      dv = this.#getDataView(dv, i, 5);
      dv.setUint8(i, Tags.LARGE_TUPLE_EXT);
      i += 1;
      dv.setUint32(i, l);
      i += 4;
    }
    for (let k = 0; k < l; k++) {
      [dv, i] = this.#encodeValue(tuple[k], dv, i);
    }
    return [dv, i];
  }

  #encodeString(str: string, dv: DataView, i: number): DvI {
    const b = this.#encoder.encode(str);
    const l = b.length;
    dv = this.#getDataView(dv, i, l + 5);
    dv.setUint8(i, Tags.BINARY_EXT);
    i += 1;
    dv.setUint32(i, l);
    i += 4;
    new Uint8Array(dv.buffer, i, l).set(b);
    return [dv, i + l];
  }

  #encodeBinary(bytes: Uint8Array, dv: DataView, i: number): DvI {
    const l = bytes.length;
    dv = this.#getDataView(dv, i, l + 5);
    dv.setUint8(i, Tags.BINARY_EXT);
    i += 1;
    dv.setUint32(i, l);
    i += 4;
    new Uint8Array(dv.buffer, i, l).set(bytes);
    return [dv, i + l];
  }

  #encodeAtom(str: string, dv: DataView, i: number): DvI {
    const b = this.#encoder.encode(str);
    const l = b.length;
    dv = this.#getDataView(dv, i, l + 3);
    // 7733248 = ATOM_UTF8_EXT(118) << 16
    dv.setUint32(i, (7733248 | l) << 8);
    i += 3;
    new Uint8Array(dv.buffer, i, l).set(b);
    return [dv, i + l];
  }

  #encodeBoolean(bool: boolean, dv: DataView, i: number): DvI {
    if (bool) {
      dv = this.#getDataView(dv, i, 6);
      // SMALL_ATOM_UTF8_EXT(119=0x77) + len=4 + "true" → [0x77, 0x04, 't', 'r', 'u', 'e']
      dv.setUint32(i, 1996780658);
      dv.setUint16(i + 4, 30053);
      return [dv, i + 6];
    } else {
      dv = this.#getDataView(dv, i, 8);
      // SMALL_ATOM_UTF8_EXT(119=0x77) + len=5 + "false" → [0x77, 0x05, 'f', 'a', 'l', 's', 'e']
      dv.setUint32(i, 1996842593);
      dv.setUint32(i + 4, 1819501824);
      // Writes 8 bytes but advances by 7 so the trailing zero is overwritten by the next value
      return [dv, i + 7];
    }
  }

  //============================================================================
  // Internal decoding functions
  //============================================================================
  #decodeValue(dv: DataView, i: number): [unknown, number] {
    switch (dv.getUint8(i)) {
      case Tags.NEW_FLOAT_EXT:
        return [dv.getFloat64(i + 1), i + 9];
      case Tags.BIT_BINARY_EXT:
        if (this.ignoreInvalidTerms) {
          const l = dv.getUint32(i + 1);
          return [null, i + l + 6];
        } else {
          throw new Error("BIT_BINARY_EXT not implemented");
        }
      case Tags.NEW_PID_EXT:
        if (this.ignoreInvalidTerms) {
          [, i] = this.#decodeValue(dv, i + 1);
          return [null, i + 12];
        } else {
          throw new Error("NEW_PID_EXT not implemented");
        }
      case Tags.NEW_PORT_EXT:
        if (this.ignoreInvalidTerms) {
          [, i] = this.#decodeValue(dv, i + 1);
          return [null, i + 8];
        } else {
          throw new Error("NEW_PORT_EXT not implemented");
        }
      case Tags.NEWER_REFERENCE_EXT:
        if (this.ignoreInvalidTerms) {
          const l = dv.getUint16(i + 1);
          [, i] = this.#decodeValue(dv, i + 3);
          return [null, i + l * 4 + 4];
        } else {
          throw new Error("NEWER_REFERENCE_EXT not implemented");
        }
      case Tags.SMALL_INTEGER_EXT:
        return [dv.getUint8(i + 1), i + 2];
      case Tags.INTEGER_EXT:
        return [dv.getInt32(i + 1), i + 5];
      case Tags.FLOAT_EXT:
        throw new Error("TODO: FLOAT_EXT not implemented");
      case Tags.ATOM_EXT:
        return this.#decodeAtom(dv, i + 1);
      case Tags.REFERENCE_EXT:
        if (this.ignoreInvalidTerms) {
          [, i] = this.#decodeValue(dv, i + 1);
          return [null, i + 5];
        } else {
          throw new Error("REFERENCE_EXT not implemented");
        }
      case Tags.PORT_EXT:
        if (this.ignoreInvalidTerms) {
          [, i] = this.#decodeValue(dv, i + 1);
          return [null, i + 5];
        } else {
          throw new Error("PORT_EXT not implemented");
        }
      case Tags.PID_EXT:
        if (this.ignoreInvalidTerms) {
          [, i] = this.#decodeValue(dv, i + 1);
          return [null, i + 9];
        } else {
          throw new Error("PID_EXT not implemented");
        }
      case Tags.SMALL_TUPLE_EXT:
        return this.#decodeTuple(dv, i + 1);
      case Tags.LARGE_TUPLE_EXT:
        return this.#decodeLargeTuple(dv, i + 1);
      case Tags.NIL_EXT:
        return [[], i + 1];
      case Tags.STRING_EXT:
        return this.#decodeShortString(dv, i + 1);
      case Tags.LIST_EXT:
        return this.#decodeArray(dv, i + 1);
      case Tags.BINARY_EXT:
        return this.#decodeString(dv, i + 1);
      case Tags.SMALL_BIG_EXT:
        return this.#decodeBigNum(dv, i + 1);
      case Tags.LARGE_BIG_EXT:
        return this.#decodeLargeBigNum(dv, i + 1);
      case Tags.NEW_FUN_EXT:
        if (this.ignoreInvalidTerms) {
          const l = dv.getUint32(i + 1);
          return [null, i + l + 1];
        } else {
          throw new Error("NEW_FUN_EXT not implemented");
        }
      case Tags.EXPORT_EXT:
        if (this.ignoreInvalidTerms) {
          [, i] = this.#decodeValue(dv, i + 1);
          [, i] = this.#decodeValue(dv, i);
          [, i] = this.#decodeValue(dv, i);
          return [null, i];
        } else {
          throw new Error("EXPORT_EXT not implemented");
        }
      case Tags.NEW_REFERENCE_EXT:
        if (this.ignoreInvalidTerms) {
          const l = dv.getUint16(i + 1);
          [, i] = this.#decodeValue(dv, i + 3);
          return [null, i + l * 4 + 1];
        } else {
          throw new Error("NEW_REFERENCE_EXT not implemented");
        }
      case Tags.SMALL_ATOM_EXT:
        // Technically incorrect as it should not support UTF-8
        return this.#decodeSmallUTF8Atom(dv, i + 1);
      case Tags.MAP_EXT:
        if (this.mapsAsObjects) return this.#decodeObject(dv, i + 1);
        else return this.#decodeMap(dv, i + 1);
      case Tags.FUN_EXT:
        throw new Error("FUN_EXT is not used since OTP R8");
      case Tags.ATOM_UTF8_EXT:
        return this.#decodeUtf8Atom(dv, i + 1);
      case Tags.SMALL_ATOM_UTF8_EXT:
        return this.#decodeSmallUTF8Atom(dv, i + 1);
      case Tags.V4_PORT_EXT:
        if (this.ignoreInvalidTerms) {
          [, i] = this.#decodeValue(dv, i + 1);
          return [null, i + 12];
        } else {
          throw new Error("V4_PORT_EXT not implemented");
        }
      default:
        throw new Error("bad_tag: " + dv.getUint8(i));
    }
  }

  #decodeObject(dv: DataView, i: number): [Record<string, unknown>, number] {
    const l = dv.getUint32(i);
    i += 4;
    const obj: Record<string, unknown> = {};
    for (let k = 0; k < l; k++) {
      let key: unknown, value: unknown;
      [key, i] = this.#decodeValue(dv, i);
      [value, i] = this.#decodeValue(dv, i);
      obj[key as string] = value;
    }
    return [obj, i];
  }

  #decodeMap(dv: DataView, i: number): [Map<unknown, unknown>, number] {
    const l = dv.getUint32(i);
    i += 4;
    const map = new Map<unknown, unknown>();
    for (let k = 0; k < l; k++) {
      let key: unknown, value: unknown;
      [key, i] = this.#decodeValue(dv, i);
      [value, i] = this.#decodeValue(dv, i);
      map.set(key, value);
    }
    return [map, i];
  }

  #decodeTuple(dv: DataView, i: number): [Tuple, number] {
    const l = dv.getUint8(i);
    i += 1;
    const tup = new Tuple();
    for (let k = 0; k < l; k++) {
      let value: unknown;
      [value, i] = this.#decodeValue(dv, i);
      tup[k] = value;
    }
    tup.freeze();
    return [tup, i];
  }

  #decodeLargeTuple(dv: DataView, i: number): [Tuple, number] {
    const l = dv.getUint32(i);
    i += 4;
    const tup = new Tuple();
    for (let k = 0; k < l; k++) {
      let value: unknown;
      [value, i] = this.#decodeValue(dv, i);
      tup[k] = value;
    }
    tup.freeze();
    return [tup, i];
  }

  #decodeArray(dv: DataView, i: number): [unknown[], number] {
    const l = dv.getUint32(i);
    i += 4;
    const arr: unknown[] = [];
    for (let k = 0; k < l; k++) {
      let value: unknown;
      [value, i] = this.#decodeValue(dv, i);
      arr[k] = value;
    }
    return [arr, i + 1];
  }

  #decodeAtom(dv: DataView, i: number): [unknown, number] {
    let str: unknown;
    [str, i] = this.#decodeShortString(dv, i);
    switch (str) {
      case "nil":
      case "null":
        return [null, i];
      case "undefined":
        return [undefined, i];
      case "true":
        return [true, i];
      case "false":
        return [false, i];
      default:
        return [this.atomsAsStrings ? str : Symbol.for(str as string), i];
    }
  }

  #decodeSmallUTF8Atom(dv: DataView, i: number): [unknown, number] {
    const l = dv.getUint8(i);
    let str: unknown;
    [str, i] = this.#decodeStringOfSize(dv, i + 1, l);
    switch (str) {
      case "nil":
      case "null":
        return [null, i];
      case "undefined":
        return [undefined, i];
      case "true":
        return [true, i];
      case "false":
        return [false, i];
      default:
        return [this.atomsAsStrings ? str : Symbol.for(str as string), i];
    }
  }

  #decodeUtf8Atom(dv: DataView, i: number): [unknown, number] {
    const l = dv.getUint16(i);
    let str: unknown;
    [str, i] = this.#decodeStringOfSize(dv, i + 2, l);
    switch (str) {
      case "nil":
      case "null":
        return [null, i];
      case "undefined":
        return [undefined, i];
      case "true":
        return [true, i];
      case "false":
        return [false, i];
      default:
        return [this.atomsAsStrings ? str : Symbol.for(str as string), i];
    }
  }

  #decodeShortString(dv: DataView, i: number): [string, number] {
    const l = dv.getUint16(i);
    return this.#decodeStringOfSize(dv, i + 2, l);
  }

  #decodeString(dv: DataView, i: number): [Uint8Array | string, number] {
    const l = dv.getUint32(i);
    if (this.binariesAsUint8Arrays)
      // .slice() is intentional: returns an independent copy so the caller's
      // Uint8Array isn't aliased into the decode buffer, which may be reused.
      return [new Uint8Array(dv.buffer, i + 4, l).slice(), i + 4 + l];
    return this.#decodeStringOfSize(dv, i + 4, l);
  }

  #decodeStringOfSize(dv: DataView, i: number, l: number): [string, number] {
    return [this.#decoder.decode(new DataView(dv.buffer, i, l)), i + l];
  }

  #decodeBigNum(dv: DataView, i: number): [number | bigint, number] {
    return this.#decodeBigNumOfSize(dv, i + 1, dv.getUint8(i));
  }

  #decodeLargeBigNum(dv: DataView, i: number): [number | bigint, number] {
    return this.#decodeBigNumOfSize(dv, i + 4, dv.getUint32(i));
  }

  #decodeBigNumOfSize(
    dv: DataView,
    i: number,
    l: number,
  ): [number | bigint, number] {
    let value = 0n;
    for (let k = 0; k < l; k++) {
      const byte = BigInt(dv.getUint8(i + 1 + k));
      const offset = BigInt(8 * k);
      value += byte << offset;
    }
    const result: number | bigint =
      value <= Number.MAX_SAFE_INTEGER ? Number(value) : value;
    return [dv.getUint8(i) === 0 ? result : -result, i + 1 + l];
  }

  //============================================================================
  // Internal utilities
  //============================================================================
  #getDataView(dv: DataView, i: number, l: number): DataView {
    // Make sure the new data fits in the data view, if not, expand it
    if (dv.byteLength < i + l) {
      return new DataView(this.#expandBuffer(dv.buffer, i + l));
    } else {
      return dv;
    }
  }

  #expandBuffer(buffer: ArrayBufferLike, minLength: number): ArrayBuffer {
    const newBuffer = new ArrayBuffer(
      Math.max(minLength, buffer.byteLength * 2),
    );
    const view = new Uint8Array(newBuffer);
    view.set(new Uint8Array(buffer as ArrayBuffer), 0);
    return newBuffer;
  }
}

export { Tuple, ETF };
