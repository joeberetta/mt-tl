# @mt-tl/tl

TL (Type Language) tooling for MTProto, used alongside `@mt-tl/server`: a `.tl`
parser/IR, a generic wire codec, value↔JSON helpers, schema-version migrations, a
**TypeScript type generator**, layer freezing, and the bundled MTProto **protocol**
schema.

```bash
npm install -D @mt-tl/tl
```

Most apps use it for two things:

## 1. Generate types from your `.tl`

```bash
npx mt-tl gen-types ./schema ./src/generated/schema.ts
```

Emits one interface per constructor, a union per type, and the `RpcMethods` map
you pass to `createServer<RpcMethods>()`.

## 2. Freeze a layer when you ship one

```bash
npx mt-tl freeze ./schema ./schema/layers 205
```

Writes `scheme_205.json` (loaded for layered encoding) + a `.tl` mirror.

## Library API

Also exports the building blocks the server uses: `parseSchemaDir`,
`generateSchemaTs` / `writeSchemaTs`, `freezeLayer`, `MigrationRegistry`,
`toJson` / `fromJson`, the RPC envelope types, and `protocolSchemaDir` (absolute
path to the bundled protocol schema).

## License

MIT
