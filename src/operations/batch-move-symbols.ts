import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { MoveToFileOperation } from './move-to-file.js';
import type { OrganizeImportsOperation } from './organize-imports.js';
import {
  type BatchItemResult,
  mergeFilesChanged,
} from './shared/batch-result.js';
import type { FileDiscovery } from './shared/file-discovery.js';
import type { FileOperations } from './shared/file-operations.js';
import {
  type SymbolDeclarationFinder,
  type SymbolKind,
  symbolKindValues,
} from './shared/symbol-declarations.js';

export const batchMoveSymbolsSchema = z.object({
  sourceFile: z.string().min(1, 'Source file cannot be empty'),
  moves: z
    .array(
      z.object({
        symbol: z.string().min(1),
        destinationPath: z.string().min(1),
        symbolKind: z.enum(symbolKindValues).optional(),
      }),
    )
    .min(1, 'At least one move must be provided'),
  symbolKind: z.enum(symbolKindValues).optional(),
  preview: z.boolean().optional(),
  organizeImports: z.boolean().optional(),
  stopOnError: z.boolean().optional(),
});

export class BatchMoveSymbolsOperation {
  constructor(
    private finder: SymbolDeclarationFinder,
    private moveToFile: MoveToFileOperation,
    private organizeImports: OrganizeImportsOperation,
    private fileOps: FileOperations,
    private discovery: FileDiscovery,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchMoveSymbolsSchema.parse(input);
      const sourceFile = this.fileOps.resolvePath(validated.sourceFile);
      const results: BatchItemResult[] = [];
      const filesChanged: RefactorResult['filesChanged'] = [];

      await this.discovery.discoverRelatedFiles(sourceFile);

      for (const move of validated.moves) {
        try {
          const symbolKind = move.symbolKind ?? validated.symbolKind;
          const declaration = await this.finder.findRequiredDeclaration(
            sourceFile,
            move.symbol,
            symbolKind as SymbolKind | undefined,
          );
          const result = await this.moveToFile.execute({
            filePath: sourceFile,
            line: declaration.startLine,
            text: move.symbol,
            destinationPath: move.destinationPath,
            preview: validated.preview,
          });
          results.push({
            item: move.symbol,
            success: result.success,
            message: result.message,
            filesChanged: result.filesChanged,
          });
          if (result.success) {
            mergeFilesChanged(filesChanged, result.filesChanged);
          } else if (validated.stopOnError) {
            break;
          }
        } catch (error) {
          results.push({
            item: move.symbol,
            success: false,
            message: error instanceof Error ? error.message : String(error),
            filesChanged: [],
          });
          if (validated.stopOnError) break;
        }
      }

      if (!validated.preview) {
        const importRewriteChanges = await this.rewriteRemainingSourceImports(
          sourceFile,
          validated.moves,
        );
        mergeFilesChanged(filesChanged, importRewriteChanges);
        const destinationImportCleanupChanges =
          await this.removeDestinationSelfImports(sourceFile, validated.moves);
        mergeFilesChanged(filesChanged, destinationImportCleanupChanges);
      }

      if (validated.organizeImports && !validated.preview) {
        const organizeTargets = new Set<string>([sourceFile]);
        for (const fileChange of filesChanged) {
          organizeTargets.add(fileChange.path);
        }
        for (const filePath of organizeTargets) {
          if (!/\.[cm]?[tj]sx?$/.test(filePath)) continue;
          const result = await this.organizeImports.execute({ filePath });
          if (result.success)
            mergeFilesChanged(filesChanged, result.filesChanged);
        }
      }

      return {
        success: results.every((result) => result.success),
        message: `Moved ${results.filter((result) => result.success).length}/${validated.moves.length} symbol(s)`,
        filesChanged,
        data: { results },
        nextActions: validated.organizeImports
          ? undefined
          : ['batch_organize_imports - Clean up imports in changed files'],
      };
    } catch (error) {
      if (error instanceof z.ZodError) return formatValidationError(error);
      return {
        success: false,
        message: `Batch move symbols failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }

  private async rewriteRemainingSourceImports(
    sourceFile: string,
    moves: Array<{ symbol: string; destinationPath: string }>,
  ): Promise<RefactorResult['filesChanged']> {
    const projectRoot = this.findProjectRoot(sourceFile);
    const projectFiles = await this.scanProjectFiles(projectRoot);
    const movedSymbolsByDestination =
      this.groupMovedSymbolsByDestination(moves);
    const destinationPaths = new Set(movedSymbolsByDestination.keys());

    const filesChanged: RefactorResult['filesChanged'] = [];

    for (const filePath of projectFiles) {
      if (destinationPaths.has(normalize(filePath))) continue;

      const originalContent = await readFile(filePath, 'utf-8');
      let content = originalContent;

      for (const [destinationPath, symbols] of movedSymbolsByDestination) {
        content = this.rewriteImportsForDestination(
          content,
          filePath,
          sourceFile,
          destinationPath,
          symbols,
        );
      }

      if (content === originalContent) continue;

      await writeFile(filePath, content, 'utf-8');
      filesChanged.push({
        file: basename(filePath),
        path: filePath,
        edits: [
          {
            line: 1,
            column: 1,
            old: originalContent,
            new: content,
          },
        ],
      });
    }

    return filesChanged;
  }

  private async removeDestinationSelfImports(
    sourceFile: string,
    moves: Array<{ symbol: string; destinationPath: string }>,
  ): Promise<RefactorResult['filesChanged']> {
    const movedSymbolsByDestination =
      this.groupMovedSymbolsByDestination(moves);
    const filesChanged: RefactorResult['filesChanged'] = [];

    for (const [destinationPath, movedSymbols] of movedSymbolsByDestination) {
      const originalContent = await readFile(destinationPath, 'utf-8');
      const content = this.removeInvalidDestinationImports(
        originalContent,
        destinationPath,
        sourceFile,
        movedSymbols,
      );

      if (content === originalContent) continue;

      await writeFile(destinationPath, content, 'utf-8');
      filesChanged.push({
        file: basename(destinationPath),
        path: destinationPath,
        edits: [
          {
            line: 1,
            column: 1,
            old: originalContent,
            new: content,
          },
        ],
      });
    }

    return filesChanged;
  }

  private groupMovedSymbolsByDestination(
    moves: Array<{ symbol: string; destinationPath: string }>,
  ): Map<string, Set<string>> {
    const movedSymbolsByDestination = new Map<string, Set<string>>();

    for (const move of moves) {
      const destinationPath = this.fileOps.resolvePath(move.destinationPath);
      const symbols =
        movedSymbolsByDestination.get(destinationPath) ?? new Set<string>();
      symbols.add(move.symbol);
      movedSymbolsByDestination.set(destinationPath, symbols);
    }

    return movedSymbolsByDestination;
  }

  private removeInvalidDestinationImports(
    content: string,
    destinationPath: string,
    sourceFile: string,
    movedSymbols: Set<string>,
  ): string {
    const importPattern =
      /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+(['"])([^'"]+)\3\s*;?/g;

    return content.replace(
      importPattern,
      (fullMatch, typeKeyword, namedImports, quote, moduleSpecifier) => {
        const imports = this.parseNamedImports(namedImports);
        const targetsDestination = this.moduleSpecifierTargetsFile(
          destinationPath,
          moduleSpecifier,
          destinationPath,
        );
        const targetsSource = this.moduleSpecifierTargetsFile(
          destinationPath,
          moduleSpecifier,
          sourceFile,
        );

        if (!targetsDestination && !targetsSource) return fullMatch;

        const remainingImports = targetsDestination
          ? []
          : imports.filter((importedSymbol) => {
              const importedName = this.getImportedName(importedSymbol);
              return !importedName || !movedSymbols.has(importedName);
            });

        if (remainingImports.length === imports.length) return fullMatch;
        if (remainingImports.length === 0) return '';

        return `import ${typeKeyword ?? ''}{ ${remainingImports.join(', ')} } from ${quote}${moduleSpecifier}${quote};`;
      },
    );
  }

  private rewriteImportsForDestination(
    content: string,
    importerPath: string,
    sourceFile: string,
    destinationPath: string,
    movedSymbols: Set<string>,
  ): string {
    const importPattern =
      /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+(['"])([^'"]+)\3\s*;?/g;

    return content.replace(
      importPattern,
      (fullMatch, typeKeyword, namedImports, quote, moduleSpecifier) => {
        if (
          !this.moduleSpecifierTargetsFile(
            importerPath,
            moduleSpecifier,
            sourceFile,
          )
        ) {
          return fullMatch;
        }

        const imports = namedImports
          ? this.parseNamedImports(namedImports)
          : [];
        const movedImports: string[] = [];
        const remainingImports: string[] = [];

        for (const importedSymbol of imports) {
          const importedName = this.getImportedName(importedSymbol);
          if (importedName && movedSymbols.has(importedName)) {
            movedImports.push(importedSymbol);
          } else {
            remainingImports.push(importedSymbol);
          }
        }

        if (movedImports.length === 0) {
          return fullMatch;
        }

        const sourceImport =
          remainingImports.length > 0
            ? `import ${typeKeyword ?? ''}{ ${remainingImports.join(', ')} } from ${quote}${moduleSpecifier}${quote};`
            : '';
        const destinationImport = `import ${typeKeyword ?? ''}{ ${movedImports.join(', ')} } from ${quote}${this.buildRelativeModuleSpecifier(
          importerPath,
          destinationPath,
          moduleSpecifier,
        )}${quote};`;

        return [sourceImport, destinationImport].filter(Boolean).join('\n');
      },
    );
  }

  private parseNamedImports(namedImports: string): string[] {
    return namedImports
      .split(',')
      .map((part: string) => part.trim())
      .filter(Boolean);
  }

  private getImportedName(importedSymbol: string): string | undefined {
    return importedSymbol
      .replace(/^type\s+/, '')
      .split(/\s+as\s+/)[0]
      ?.trim();
  }

  private moduleSpecifierTargetsFile(
    importerPath: string,
    moduleSpecifier: string,
    targetFile: string,
  ): boolean {
    if (!moduleSpecifier.startsWith('.')) return false;

    const basePath = resolve(dirname(importerPath), moduleSpecifier);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.jsx`,
      join(basePath, 'index.ts'),
      join(basePath, 'index.tsx'),
      join(basePath, 'index.js'),
      join(basePath, 'index.jsx'),
    ];

    return candidates.some(
      (candidate) => normalize(candidate) === normalize(targetFile),
    );
  }

  private buildRelativeModuleSpecifier(
    importerPath: string,
    destinationPath: string,
    sourceModuleSpecifier: string,
  ): string {
    const extension = extname(destinationPath);
    const destinationWithoutExtension =
      extension.length > 0
        ? destinationPath.slice(0, -extension.length)
        : destinationPath;
    let specifier = relative(dirname(importerPath), destinationWithoutExtension)
      .split(sep)
      .join('/');

    if (!specifier.startsWith('.')) {
      specifier = `./${specifier}`;
    }

    if (sourceModuleSpecifier.endsWith('.js')) {
      specifier += '.js';
    }

    return specifier;
  }

  private findProjectRoot(filePath: string): string {
    let currentDir = dirname(filePath);

    while (dirname(currentDir) !== currentDir) {
      if (existsSync(join(currentDir, 'tsconfig.json'))) {
        return currentDir;
      }
      currentDir = dirname(currentDir);
    }

    return dirname(filePath);
  }

  private async scanProjectFiles(root: string): Promise<string[]> {
    const files: string[] = [];

    const scan = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(directory, entry.name);

        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name.startsWith('.')
          ) {
            continue;
          }
          await scan(fullPath);
          continue;
        }

        if (
          entry.isFile() &&
          /\.[cm]?[tj]sx?$/.test(entry.name) &&
          !entry.name.endsWith('.d.ts')
        ) {
          files.push(fullPath);
        }
      }
    };

    await scan(root);
    return files;
  }
}
