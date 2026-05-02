# TypeScript Refactoring Operations Catalog

## File Operations

### rename_file
**What**: Rename file with automatic import path updates
**Time**: < 1s
**Safe**: All importing files automatically updated

**Example**: Rename service.ts to api-service.ts
```typescript
Input: {
  operation: "rename_file",
  sourcePath: "src/service.ts",
  newName: "api-service.ts"
}

Result: Updates all imports from './service' to './api-service'
```

### move_file
**What**: Move file to different directory with automatic import path updates
**Time**: < 1s
**Safe**: All importing files automatically updated

**Example**: Move src/old/service.ts → src/new/service.ts
```typescript
Input: {
  operation: "move_file",
  sourcePath: "src/old/service.ts",
  destinationPath: "src/new/service.ts"
}

Result: Updates all imports from '../old/service' to '../new/service'
```

### batch_move_files
**What**: Move multiple files atomically with import updates
**Time**: < 2s for 10-20 files

**Example**: Reorganize utilities
```typescript
Input: {
  operation: "batch_move_files",
  files: ["util1.ts", "util2.ts", "util3.ts"],
  targetFolder: "src/utils"
}

Result: Moves all files + updates all imports across codebase
```

---

## Code Quality

### organize_imports
**What**: Sort imports alphabetically + remove unused imports
**Time**: < 500ms per file
**Safe**: Preserves side-effect imports

**Example**:
```typescript
// Before
import { z } from 'unused';
import { c, a, b } from '../utils';
import './styles.css';

// After
import './styles.css';  // Side-effect preserved
import { a, b, c } from '../utils';  // Sorted, unused removed
```

### batch_organize_imports
**What**: Organize imports across multiple files in one request
**Time**: Loops the existing organize_imports operation per file
**Use when**: After batch moves, file splits, or generated refactors touched many imports

**Example**:
```typescript
Input: {
  operation: "batch_organize_imports",
  filePaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
  stopOnError: false,
  responseMode: "summary"
}

Result: Organizes imports in each file and reports compact per-file success/failure.
Use `responseMode: "full"` only when you need full edit payloads.
```

### check_refactor_artifacts
**What**: Scan changed files for common generated refactor artifacts
**Time**: < 100ms for small changed-file sets
**Use when**: After move/extract/batch operations before typecheck

**Checks**:
- `undefined-imports`: generated `import { undefined }`
- `type-type`: duplicated `type type`
- `self-imports`: imports that target the same file
- `type-only-runtime-imports`: type-only imports used as runtime values
- `deep-facade-imports`: imports under a configured facade path

**Example**:
```typescript
Input: {
  operation: "check_refactor_artifacts",
  filePaths: ["src/domain/feature/a.ts", "src/domain/feature/index.ts"],
  facadePaths: ["src/domain/feature/index.ts"]
}

Result: Returns findings with check name, file, line, and import text
```

### fix_all
**What**: Apply ALL available TypeScript quick fixes
**Safe**: Only applies compiler-approved fixes

**Common fixes**:
- Add missing properties
- Fix type mismatches
- Convert to async/await
- Add missing imports
- Remove unused code

### remove_unused
**What**: Remove ALL unused variables and imports
**Safe**: Never removes side-effect code
**vs fix_all**: More aggressive, targets unused code specifically

---

## Refactoring

### rename
**What**: TypeScript-aware symbol renaming with automatic import/export updates
**Time**: < 1s across entire codebase
**vs Edit**: Updates ALL references including dynamic imports, re-exports, type references
**vs grep/sed**: Compiler-aware, prevents breaking references

**Example**: Rename 'calculateSum' to 'computeSum'
```typescript
Input: {
  operation: "rename",
  filePath: "src/math.ts",
  line: 5,
  text: "calculateSum",
  newName: "computeSum"
}

Result: Updates 47 references across 12 files:
  ✓ Function declaration
  ✓ All call sites: calculateSum(1, 2) → computeSum(1, 2)
  ✓ All imports: import { calculateSum } → import { computeSum }
  ✓ All exports and re-exports
  ✓ JSDoc references
```

### batch_rename_symbols
**What**: Rename multiple top-level symbols by declaration name
**Why**: Avoid repeated "find line, rename, find next line" loops
**Safe**: Uses the existing TypeScript-aware rename operation for each symbol

**Example**:
```typescript
Input: {
  operation: "batch_rename_symbols",
  renames: [
    { filePath: "src/math.ts", symbol: "sum", newName: "add" },
    { filePath: "src/math.ts", symbol: "product", newName: "multiply" }
  ],
  preview: false,
  stopOnError: true
}

Result: Finds each declaration line and renames all references
```

### extract_function
**What**: Extract code to function with auto-detected parameters and return types
**Magic**: Analyzes closures, mutations, control flow automatically

**Example**: Extract "const result = x + y" with name "addNumbers"
```typescript
// Before
function calculate(x: number, y: number) {
  const result = x + y;
  return result * 2;
}

// After
function addNumbers(x: number, y: number): number {
  return x + y;
}

function calculate(x: number, y: number) {
  const result = addNumbers(x, y);
  return result * 2;
}
```

Auto-detects:
- Parameters needed (x, y)
- Return type (number)
- Proper scope (module/function/block)
- Variable mutations

### extract_constant
**What**: Extract magic numbers/strings to named constants
**Scope**: Auto-detects optimal scope (module/function/block)

**Example**: Extract 3.14159 with name "PI"
```typescript
// Before
const area = 3.14159 * radius * radius;
const circumference = 2 * 3.14159 * radius;

// After
const PI = 3.14159;
const area = PI * radius * radius;
const circumference = 2 * PI * radius;
```

### extract_variable
**What**: Extract complex expressions to local variables
**Benefit**: Reduces duplication, improves readability

### move_to_file
**What**: Move a top-level symbol to another file with automatic import updates
**Time**: < 1s
**vs Edit**: Updates all imports/exports across the codebase automatically

**Example**: Move `parseConfig` to a dedicated file
```typescript
Input: {
  operation: "move_to_file",
  filePath: "src/utils.ts",
  line: 10,
  text: "parseConfig",
  destinationPath: "src/config/parser.ts"
}

Result: Moves parseConfig to new file + updates all imports:
  ✓ Moves the full declaration
  ✓ Creates destination file (with directory) if needed
  ✓ Updates all import paths across the codebase
  ✓ Preserves dependent type imports
```

**Without destinationPath**: TypeScript auto-generates a new file name
```typescript
Input: {
  operation: "move_to_file",
  filePath: "src/utils.ts",
  line: 10,
  text: "parseConfig"
}

Result: Moves parseConfig to auto-named new file (e.g. src/parseConfig.ts)
```

### batch_move_symbols
**What**: Move multiple top-level symbols from one source file to destination files
**Why**: Re-finds each declaration after earlier moves, so shifting line numbers do not matter
**Safe**: Uses the existing move_to_file operation for each symbol

**Example**:
```typescript
Input: {
  operation: "batch_move_symbols",
  sourceFile: "src/big-file.ts",
  symbolKind: "function",
  moves: [
    { symbol: "parseConfig", destinationPath: "src/config/parseConfig.ts" },
    { symbol: "formatConfig", destinationPath: "src/config/formatConfig.ts" }
  ],
  organizeImports: true,
  stopOnError: true,
  preserveSourceFacadeExports: true,
  preferFacadeImports: true,
  responseMode: "summary"
}

Result: Moves both symbols and updates imports/exports across the project
```

Options:
- `preserveSourceFacadeExports`: re-export moved exported symbols from the original source file.
- `preferFacadeImports`: when facade exports are preserved, keep outside callers importing from the original source file instead of deep destination files.
- `responseMode`: defaults to `"summary"` and omits large edit payloads. Use `"full"` when exact edit details are needed.

### infer_return_type
**What**: Generate perfect return type annotations automatically
**Benefit**: Even complex nested objects and union types - no guessing

**Example**:
```typescript
// Before
function getData() {
  return { name: 'test', count: 42 };
}

// After
function getData(): { name: string; count: number } {
  return { name: 'test', count: 42 };
}
```

---

## Workspace

### find_references
**What**: Find ALL usages with type-aware analysis
**vs grep**: Catches dynamic imports, re-exports, type-only imports, JSDoc refs

**Example**: Find references to 'helper' function
```typescript
Found 3 reference(s) in 2 file(s):
utils.ts: Line 1: export function helper()...
main.ts: Line 1: const result = helper();
main.ts: Line 2: const another = helper();
```

### batch_find_references
**What**: Find references for multiple top-level symbols in one request
**Why**: Faster impact analysis before a large rename or file split

**Example**:
```typescript
Input: {
  operation: "batch_find_references",
  queries: [
    { filePath: "src/math.ts", symbol: "sum" },
    { filePath: "src/math.ts", symbol: "product" }
  ]
}

Result: Returns one result item per symbol with the existing find_references summary
```

### find_symbol_declarations
**What**: List top-level declarations in a file
**Returns**: symbol, kind, exported/private, start/end line, and imported dependencies used by that declaration
**Use when**: Planning batch refactors without manually locating declaration lines

**Example**:
```typescript
Input: {
  operation: "find_symbol_declarations",
  filePath: "src/big-file.ts",
  symbols: ["parseConfig", "ConfigShape"],
  symbolKind: "any"
}

Result: Reports declaration metadata that can feed batch_move_symbols, batch_rename_symbols, or batch_find_references
```

### refactor_module
**What**: Complete module refactoring workflow in one operation
**Steps**: Move file → Organize imports → Fix errors
**Time**: < 2s

**Example**: Move and clean up service.ts
```typescript
Input: {
  operation: "refactor_module",
  sourcePath: "src/old/service.ts",
  destinationPath: "src/new/service.ts"
}

Performs:
1. Moves the file
2. Updates all import paths
3. Organizes imports in all affected files
4. Fixes any TypeScript errors
```

### cleanup_codebase
**What**: Clean entire codebase - organize imports + optionally remove unused files
**Default**: Safe mode (organize imports only)
**Aggressive**: Set `deleteUnusedFiles: true` to remove unused exports/files

⚠️ **WARNING**: Aggressive mode DELETES files. Use preview mode first!

**Entry Points**: Files your app starts from
- **Optional for safe mode** (organize imports only)
- **REQUIRED when `deleteUnusedFiles: true`** - prevents accidental deletion with wrong defaults
- **Default patterns**: `main|index|app|server` + all test files
- Tool follows imports from entry points to find used code
- Anything not reachable = unused
- Custom regex: `["src/main\\.ts$", "scripts/.*\\.ts$"]`

**Example**: Safe cleanup
```typescript
Input: {
  operation: "cleanup_codebase",
  directory: "src"
}

Result:
- Organizes imports in all files
- Preserves all files and exports
- Skips node_modules and hidden directories
```

**Example**: Aggressive cleanup
```typescript
Input: {
  operation: "cleanup_codebase",
  directory: "src",
  deleteUnusedFiles: true,
  entrypoints: ["src/main\\.ts$", "src/cli\\.ts$"],  // REQUIRED with deleteUnusedFiles
  preview: true  // See what would be deleted
}

Result:
- Removes unused exports (via tsr)
- Deletes files with no used exports
- Organizes imports in remaining files
```

### minimize_exports
**What**: Remove `export` modifiers from selected files when symbols are not imported or re-exported elsewhere
**Time**: Scans project files once, then edits requested files
**Use when**: After moving symbols out of a large source file, to shrink the source file's public surface
**Default response**: Compact summary with no full edit payloads

**Example**:
```typescript
Input: {
  operation: "minimize_exports",
  filePaths: ["src/domain/local-region/simulation/wildlife.ts"],
  preserveSymbols: ["advanceWildlifeForLocalRegionTick"],
  responseMode: "summary"
}

Result: Removes unnecessary export keywords from unreferenced symbols and reports removed symbols
```

### restart_tsserver
**What**: Restart TypeScript server to refresh project state
**Use when**: After tsconfig changes, dependency updates, or stale type info
**Time**: 5-10 seconds to restart + re-index

---

## Tips & Best Practices

### Always Use Preview Mode First
For destructive operations:
```typescript
{ operation: "cleanup_codebase", directory: "src", deleteUnusedFiles: true, preview: true }
```

### Verify Before Refactoring
Use find_references to understand impact:
```typescript
{ operation: "find_references", filePath: "src/util.ts", line: 10, text: "helper" }
```

### Chain Operations
Common workflows:
1. Rename → organize_imports → fix_all
2. Move → refactor_module (does organize + fix automatically)
3. Extract → organize_imports

### Performance Tips
- cleanup_codebase is expensive (scans entire project) - use on-demand
- find_references can take 5-10s on large codebases while indexing
- Most other operations complete in < 1s
