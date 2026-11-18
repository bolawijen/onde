// Data-oriented Type IR.
//
// A type is an integer id: its slot in the table. All type data lives in flat
// parallel arrays indexed by that id, so constructing or walking types never
// allocates per-type objects. Every id claims one slot in every array (unused
// slots stay 0) which keeps the arrays index-aligned with `kinds`.

export enum TypeKind {
  // Primitives. Registered first, in this order, so a primitive's id equals its
  // kind (Unknown === 0, String === 6).
  Unknown = 0,
  Void = 1,
  Null = 2,
  Undefined = 3,
  Boolean = 4,
  Number = 5,
  String = 6,

  // Compound types. Ids are assigned on demand.
  Array = 7,
  Object = 8,
  Function = 9,
}

// Number of primitive slots reserved by `create` (everything below Array).
export const PRIMITIVE_COUNT = TypeKind.Array;

export type TypeTable = {
  kinds: number[],

  // Array: element type id.
  elemTypes: number[],

  // Object: property names + types, sliced by [start, start + count).
  propStarts: number[],
  propCounts: number[],
  propNames: number[],
  propTypes: number[],

  // Function: parameter types + return type.
  paramStarts: number[],
  paramCounts: number[],
  paramTypes: number[],
  retTypes: number[],
}

export function create(): TypeTable {
  const t: TypeTable = {
    kinds: [],

    elemTypes: [],

    propStarts: [], propCounts: [], propNames: [], propTypes: [],

    paramStarts: [], paramCounts: [], paramTypes: [], retTypes: [],
  }
  for (let kind = 0; kind < PRIMITIVE_COUNT; kind++) push(t, kind);
  return t;
}

// Claim the next type id and keep the parallel arrays aligned.
function push(t: TypeTable, kind: TypeKind): number {
  const id = t.kinds.length;
  t.kinds.push(kind);
  t.elemTypes.push(0);
  t.propStarts.push(0); t.propCounts.push(0);
  t.paramStarts.push(0); t.paramCounts.push(0);
  t.retTypes.push(0);
  return id;
}

export function isPrimitive(id: number): boolean {
  return id >= 0 && id < PRIMITIVE_COUNT;
}

export function kindOf(t: TypeTable, id: number): TypeKind {
  return t.kinds[id];
}

export function arrayOf(t: TypeTable, elem: number): number {
  const id = push(t, TypeKind.Array);
  t.elemTypes[id] = elem;
  return id;
}

export function elementOf(t: TypeTable, id: number): number {
  return t.elemTypes[id];
}

// `names` are interned name ids, `types` are type ids; same length.
export function objectOf(t: TypeTable, names: number[], types: number[]): number {
  const id = push(t, TypeKind.Object);
  t.propStarts[id] = t.propNames.length;
  t.propCounts[id] = names.length;
  for (let i = 0; i < names.length; i++) {
    t.propNames.push(names[i]);
    t.propTypes.push(types[i]);
  }
  return id;
}

export function propCount(t: TypeTable, id: number): number {
  return t.propCounts[id];
}

export function propNameOf(t: TypeTable, id: number, i: number): number {
  return t.propNames[t.propStarts[id] + i];
}

export function propTypeOf(t: TypeTable, id: number, i: number): number {
  return t.propTypes[t.propStarts[id] + i];
}

export function funcOf(t: TypeTable, params: number[], ret: number): number {
  const id = push(t, TypeKind.Function);
  t.paramStarts[id] = t.paramTypes.length;
  t.paramCounts[id] = params.length;
  for (const p of params) t.paramTypes.push(p);
  t.retTypes[id] = ret;
  return id;
}

export function paramCount(t: TypeTable, id: number): number {
  return t.paramCounts[id];
}

export function paramTypeOf(t: TypeTable, id: number, i: number): number {
  return t.paramTypes[t.paramStarts[id] + i];
}

export function returnOf(t: TypeTable, id: number): number {
  return t.retTypes[id];
}
