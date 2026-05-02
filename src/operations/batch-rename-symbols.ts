import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { RenameOperation } from './rename.js';
import {
  type BatchItemResult,
  mergeFilesChanged,
} from './shared/batch-result.js';
import type { SymbolDeclarationFinder } from './shared/symbol-declarations.js';

export const batchRenameSymbolsSchema = z.object({
  renames: z
    .array(
      z.object({
        filePath: z.string().min(1),
        symbol: z.string().min(1),
        newName: z.string().min(1),
      }),
    )
    .min(1, 'At least one rename must be provided'),
  preview: z.boolean().optional(),
  stopOnError: z.boolean().optional(),
});

export class BatchRenameSymbolsOperation {
  constructor(
    private finder: SymbolDeclarationFinder,
    private rename: RenameOperation,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchRenameSymbolsSchema.parse(input);
      const results: BatchItemResult[] = [];
      const filesChanged: RefactorResult['filesChanged'] = [];

      for (const rename of validated.renames) {
        try {
          const declaration = await this.finder.findRequiredDeclaration(
            rename.filePath,
            rename.symbol,
          );
          const result = await this.rename.execute({
            filePath: rename.filePath,
            line: declaration.startLine,
            text: rename.symbol,
            name: rename.newName,
            preview: validated.preview,
          });
          results.push({
            item: rename.symbol,
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
            item: rename.symbol,
            success: false,
            message: error instanceof Error ? error.message : String(error),
            filesChanged: [],
          });
          if (validated.stopOnError) break;
        }
      }

      return {
        success: results.every((result) => result.success),
        message: `Renamed ${results.filter((result) => result.success).length}/${validated.renames.length} symbol(s)`,
        filesChanged,
        data: { results },
      };
    } catch (error) {
      if (error instanceof z.ZodError) return formatValidationError(error);
      return {
        success: false,
        message: `Batch rename symbols failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }
}
