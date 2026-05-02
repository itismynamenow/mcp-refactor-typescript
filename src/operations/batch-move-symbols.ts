import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { MoveToFileOperation } from './move-to-file.js';
import type { OrganizeImportsOperation } from './organize-imports.js';
import {
  type BatchItemResult,
  mergeFilesChanged,
} from './shared/batch-result.js';
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
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchMoveSymbolsSchema.parse(input);
      const sourceFile = this.fileOps.resolvePath(validated.sourceFile);
      const results: BatchItemResult[] = [];
      const filesChanged: RefactorResult['filesChanged'] = [];

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
}
