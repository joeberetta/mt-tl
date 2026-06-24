// Browser-side mirror of @mt-tl/tl's IR types (ir.ts), so the client codec has no
// runtime/type dependency on the node engine's source (which imports node:fs +
// Buffer and breaks a browser typecheck). Same pattern as spec-types.ts. These
// shapes are structurally identical to the engine's, so parsed `TlDef`s from
// @mt-tl/tl are assignable to them in node-side tests.

export type TlType =
    | { kind: 'int' }
    | { kind: 'long' }
    | { kind: 'double' }
    | { kind: 'string' }
    | { kind: 'bytes' }
    | { kind: 'int128' }
    | { kind: 'int256' }
    | { kind: 'bool' }
    | { kind: 'true' }
    | { kind: 'flags' }
    | { kind: 'flag'; flagsField: string; bit: number; inner: TlType }
    | { kind: 'vector'; boxed: boolean; inner: TlType }
    | { kind: 'object' }
    | { kind: 'boxed'; name: string }
    | { kind: 'bare'; name: string }

export interface TlParam {
    name: string
    raw: string
    type: TlType
}

export interface TlDef {
    id: string
    idNum: number
    name: string
    kind: 'constructor' | 'method'
    params: TlParam[]
    type: string
    isProtocol: boolean
}
