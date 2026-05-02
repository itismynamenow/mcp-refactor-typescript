# Project Agent Guide

## Commands

- Prefer `mcp-common-commands` for test commands whose arguments change between runs.
- Use `bun_test(args: string[], timeoutMs?: number, projectName?: string)` for Bun test invocations instead of direct shell commands such as `bun test ...`.
- For this repo, pass `projectName: "mcp-refactor-typescript"` when using `mcp-common-commands`.
- Example: `bun_test({ projectName: "mcp-refactor-typescript", args: ["--timeout", "30000", "src/operations/__tests__/batch-symbol-operations.integration.test.ts"], timeoutMs: 120000 })`.
- Direct shell commands are acceptable for fixed package scripts that already have standing approval, such as `bun run typecheck`, `bun run lint`, and `bun run build`.

## Refactoring

- Prefer this repo's own TypeScript refactor MCP tools for semantic symbol moves, renames, file moves, and import cleanup when testing real behavior across projects.
- After changing MCP tool behavior, run focused regression tests first, then typecheck, lint, unit tests, and build when practical.
