import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { FileOperations } from './shared/file-operations.js';

interface ExportCandidate {
  symbols: string[];
  start: number;
  end: number;
}

export const minimizeExportsSchema = z.object({
  filePaths: z.array(z.string().min(1)).min(1),
  preserveSymbols: z.array(z.string().min(1)).optional(),
  preservePublicEntrypoints: z.array(z.string().min(1)).optional(),
  preview: z.boolean().optional(),
  responseMode: z.enum(['summary', 'full']).optional(),
});

export class MinimizeExportsOperation {
  constructor(private fileOps: FileOperations) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = minimizeExportsSchema.parse(input);
      const preserveSymbols = new Set(
        validated.preserveSymbols ?? validated.preservePublicEntrypoints ?? [],
      );
      const responseMode = validated.responseMode ?? 'summary';
      const resolvedFilePaths = validated.filePaths.map((filePath) =>
        this.fileOps.resolvePath(filePath),
      );
      const projectRoot = this.findProjectRoot(resolvedFilePaths[0]);
      const projectFiles = await this.scanProjectFiles(projectRoot);
      const filesChanged: RefactorResult['filesChanged'] = [];
      const removedExports: Array<{
        file: string;
        path: string;
        symbol: string;
      }> = [];

      for (const filePath of resolvedFilePaths) {
        const originalContent = await readFile(filePath, 'utf-8');
        const candidates = this.findExportCandidates(filePath, originalContent)
          .filter((candidate) =>
            candidate.symbols.every((symbol) => !preserveSymbols.has(symbol)),
          )
          .filter((candidate) =>
            candidate.symbols.every(
              (symbol) =>
                !this.isReferencedOutsideFile(symbol, filePath, projectFiles),
            ),
          );

        if (candidates.length === 0) continue;

        const content = this.removeExportModifiers(originalContent, candidates);

        if (!validated.preview) {
          await writeFile(filePath, content, 'utf-8');
        }

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

        removedExports.push(
          ...candidates.flatMap((candidate) =>
            candidate.symbols.map((symbol) => ({
              file: basename(filePath),
              path: filePath,
              symbol,
            })),
          ),
        );
      }

      const responseFilesChanged =
        responseMode === 'full'
          ? filesChanged
          : filesChanged.map((fileChange) => ({
              file: fileChange.file,
              path: fileChange.path,
              edits: [],
            }));

      return {
        success: true,
        message: `Removed ${removedExports.length} unnecessary export(s)`,
        filesChanged: responseFilesChanged,
        data: {
          responseMode,
          removedExports,
          filesChanged: responseFilesChanged.map((fileChange) => ({
            file: fileChange.file,
            path: fileChange.path,
          })),
        },
        preview: validated.preview
          ? {
              filesAffected: responseFilesChanged.length,
              estimatedTime: '< 1s',
              command: 'Run again with preview: false to apply changes',
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof z.ZodError) return formatValidationError(error);
      return {
        success: false,
        message: `Minimize exports failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }

  private findExportCandidates(
    filePath: string,
    content: string,
  ): ExportCandidate[] {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS,
    );
    const candidates: ExportCandidate[] = [];

    for (const statement of sourceFile.statements) {
      const exportModifier = ts.canHaveModifiers(statement)
        ? ts
            .getModifiers(statement)
            ?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        : undefined;
      if (!exportModifier) continue;

      const symbols = this.getStatementSymbols(statement);
      if (symbols.length > 0) {
        candidates.push({
          symbols,
          start: exportModifier.getStart(sourceFile),
          end: exportModifier.getEnd(),
        });
      }
    }

    return candidates;
  }

  private getStatementSymbols(statement: ts.Statement): string[] {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      return [statement.name.text];
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      return [statement.name.text];
    }
    if (ts.isInterfaceDeclaration(statement)) {
      return [statement.name.text];
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      return [statement.name.text];
    }
    if (ts.isEnumDeclaration(statement)) {
      return [statement.name.text];
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations
        .map((declaration) =>
          ts.isIdentifier(declaration.name) ? declaration.name.text : undefined,
        )
        .filter((symbol): symbol is string => !!symbol);
    }
    return [];
  }

  private removeExportModifiers(
    content: string,
    candidates: ExportCandidate[],
  ): string {
    const ranges = Array.from(
      new Map(
        candidates.map((candidate) => [
          `${candidate.start}:${candidate.end}`,
          { start: candidate.start, end: candidate.end },
        ]),
      ).values(),
    ).sort((left, right) => right.start - left.start);

    let updatedContent = content;
    for (const range of ranges) {
      updatedContent = `${updatedContent.slice(0, range.start)}${updatedContent.slice(range.end).replace(/^\s+/, '')}`;
    }

    return updatedContent;
  }

  private isReferencedOutsideFile(
    symbol: string,
    filePath: string,
    projectFiles: string[],
  ): boolean {
    const symbolPattern = new RegExp(`\\b${this.escapeRegExp(symbol)}\\b`);

    return projectFiles.some((projectFile) => {
      if (normalize(projectFile) === normalize(filePath)) return false;
      const content = this.readFileSyncSafe(projectFile);
      return content ? symbolPattern.test(content) : false;
    });
  }

  private readFileSyncSafe(filePath: string): string | null {
    try {
      return ts.sys.readFile(filePath) ?? null;
    } catch {
      return null;
    }
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

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
