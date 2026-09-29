/**
 * Types for `isMainModule.mjs`, for the TypeScript callers that a type-checked
 * program reaches — `server/mcp/scripts/gen-mcp-contracts.ts` is pulled into
 * `server/mcp`'s `tsc -p tsconfig.test.json` through its unit test.
 *
 * @coordinates-with scripts/lib/isMainModule.mjs — the implementation
 */

/** Whether the module at `moduleUrl` (the caller's `import.meta.url`) is the process's entry script. */
export function isMainModule(moduleUrl: string): boolean;
