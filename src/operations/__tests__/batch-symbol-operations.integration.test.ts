import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import type { BatchFindReferencesOperation } from '../batch-find-references.js';
import type { BatchMoveSymbolsOperation } from '../batch-move-symbols.js';
import type { BatchOrganizeImportsOperation } from '../batch-organize-imports.js';
import type { BatchRenameSymbolsOperation } from '../batch-rename-symbols.js';
import type { FindSymbolDeclarationsOperation } from '../find-symbol-declarations.js';
import {
  createBatchFindReferencesOperation,
  createBatchMoveSymbolsOperation,
  createBatchOrganizeImportsOperation,
  createBatchRenameSymbolsOperation,
  createFindSymbolDeclarationsOperation,
} from '../shared/operation-factory.js';
import type { SymbolDeclaration } from '../shared/symbol-declarations.js';
import {
  cleanupTestCase,
  cleanupTestWorkspace,
  createTestDir,
  setupTestCase,
  setupTestWorkspace,
} from './test-utils.js';

const testDir = createTestDir();

let testServer: TypeScriptServer | null = null;

interface BatchResultData {
  results: Array<{
    item: string;
    success: boolean;
    message: string;
  }>;
}

describe('batch symbol operations', () => {
  beforeAll(() => setupTestWorkspace(testDir));
  afterAll(() => cleanupTestWorkspace(testDir));

  beforeEach(async () => {
    testServer = await setupTestCase(testDir, TypeScriptServer);
  });

  afterEach(() => cleanupTestCase(testServer));

  it('should list top-level symbol declarations with visibility and import dependencies', async () => {
    const helperPath = join(testDir, 'src', 'helper.ts');
    const filePath = join(testDir, 'src', 'symbols.ts');
    await writeFile(helperPath, 'export function helper() { return 1; }');
    await writeFile(
      filePath,
      `import { helper } from './helper.js';

export function alpha() {
  return helper();
}

const beta = 2;

interface Gamma {
  value: string;
}

export type Delta = Gamma;
`,
      'utf-8',
    );

    const operation = createFindSymbolDeclarationsOperation(
      testServer!,
    ) as FindSymbolDeclarationsOperation;
    const response = await operation.execute({
      filePath,
      symbols: ['alpha', 'beta', 'Gamma', 'Delta'],
    });

    expect(response.success).toBe(true);
    const declarations = (
      response.data as { declarations: SymbolDeclaration[] }
    ).declarations;
    expect(declarations.map((declaration) => declaration.symbol)).toEqual([
      'alpha',
      'beta',
      'Gamma',
      'Delta',
    ]);
    expect(declarations.find((d) => d.symbol === 'alpha')).toMatchObject({
      kind: 'function',
      exported: true,
      dependencies: [{ name: 'helper', moduleSpecifier: './helper.js' }],
    });
    expect(declarations.find((d) => d.symbol === 'beta')).toMatchObject({
      kind: 'const',
      exported: false,
    });
    expect(declarations.find((d) => d.symbol === 'Gamma')).toMatchObject({
      kind: 'interface',
      exported: false,
    });
    expect(declarations.find((d) => d.symbol === 'Delta')).toMatchObject({
      kind: 'type',
      exported: true,
    });
  });

  it('should rename multiple top-level symbols by declaration name', async () => {
    const filePath = join(testDir, 'src', 'rename-many.ts');
    await writeFile(
      filePath,
      `export function alpha() {
  return 1;
}

export const beta = alpha();
`,
      'utf-8',
    );

    const operation = createBatchRenameSymbolsOperation(
      testServer!,
    ) as BatchRenameSymbolsOperation;
    const response = await operation.execute({
      renames: [
        { filePath, symbol: 'alpha', newName: 'renamedAlpha' },
        { filePath, symbol: 'beta', newName: 'renamedBeta' },
      ],
    });

    expect(response.success).toBe(true);
    expect(response.message).toBe('Renamed 2/2 symbol(s)');
    const data = response.data as BatchResultData;
    expect(data.results.every((result) => result.success)).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('function renamedAlpha');
    expect(content).toContain('export const renamedBeta = renamedAlpha();');
    expect(content).not.toContain('alpha');
    expect(content).not.toContain('beta');
  });

  it('should find references for multiple symbols by declaration name', async () => {
    const libPath = join(testDir, 'src', 'lib.ts');
    const mainPath = join(testDir, 'src', 'main.ts');
    await writeFile(
      libPath,
      `export function alpha() { return 1; }
export const beta = alpha();
`,
      'utf-8',
    );
    await writeFile(
      mainPath,
      `import { alpha, beta } from './lib.js';

console.error(alpha(), beta);
`,
      'utf-8',
    );

    const operation = createBatchFindReferencesOperation(
      testServer!,
    ) as BatchFindReferencesOperation;
    const response = await operation.execute({
      queries: [
        { filePath: libPath, symbol: 'alpha' },
        { filePath: libPath, symbol: 'beta' },
      ],
    });

    expect(response.success).toBe(true);
    const data = response.data as BatchResultData;
    expect(data.results).toHaveLength(2);
    expect(data.results.every((result) => result.success)).toBe(true);
    expect(data.results[0].message).toContain('reference');
    expect(data.results[0].message).toContain('main.ts');
    expect(data.results[1].message).toContain('main.ts');
  });

  it('should organize imports across multiple files', async () => {
    const depsPath = join(testDir, 'src', 'deps.ts');
    const firstPath = join(testDir, 'src', 'first.ts');
    const secondPath = join(testDir, 'src', 'second.ts');
    await writeFile(
      depsPath,
      `export const alpha = 1;
export const zebra = 2;
`,
      'utf-8',
    );
    await writeFile(
      firstPath,
      `import { zebra, alpha } from './deps.js';

console.error(alpha, zebra);
`,
      'utf-8',
    );
    await writeFile(
      secondPath,
      `import { zebra, alpha } from './deps.js';

export const values = [zebra, alpha];
`,
      'utf-8',
    );

    const operation = createBatchOrganizeImportsOperation(
      testServer!,
    ) as BatchOrganizeImportsOperation;
    const response = await operation.execute({
      filePaths: [firstPath, secondPath],
    });

    expect(response.success).toBe(true);
    expect(response.message).toBe('Organized imports for 2/2 file(s)');
    expect(await readFile(firstPath, 'utf-8')).toContain(
      "import { alpha, zebra } from './deps.js';",
    );
    expect(await readFile(secondPath, 'utf-8')).toContain(
      "import { alpha, zebra } from './deps.js';",
    );
  });

  it('should move multiple symbols while finding each declaration after earlier moves', async () => {
    const sourcePath = join(testDir, 'src', 'source.ts');
    const alphaPath = join(testDir, 'src', 'alpha.ts');
    const betaPath = join(testDir, 'src', 'beta.ts');
    await writeFile(
      sourcePath,
      `export function alpha() {
  return 1;
}

export function beta() {
  return 2;
}

export function gamma() {
  return alpha() + beta();
}
`,
      'utf-8',
    );

    const operation = createBatchMoveSymbolsOperation(
      testServer!,
    ) as BatchMoveSymbolsOperation;
    const response = await operation.execute({
      sourceFile: sourcePath,
      symbolKind: 'function',
      moves: [
        { symbol: 'alpha', destinationPath: alphaPath },
        { symbol: 'beta', destinationPath: betaPath },
      ],
    });

    expect(response.success).toBe(true);
    expect(response.message).toBe('Moved 2/2 symbol(s)');

    const sourceContent = await readFile(sourcePath, 'utf-8');
    expect(sourceContent).not.toContain('function alpha');
    expect(sourceContent).not.toContain('function beta');
    expect(sourceContent).toContain('function gamma');
    expect(sourceContent).toContain('alpha() + beta()');
    expect(await readFile(alphaPath, 'utf-8')).toContain('function alpha');
    expect(await readFile(betaPath, 'utf-8')).toContain('function beta');
  });
});
