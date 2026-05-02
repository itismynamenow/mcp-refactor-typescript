import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { FindReferencesOperation } from './find-references.js';
import type { BatchItemResult } from './shared/batch-result.js';
import type { SymbolDeclarationFinder } from './shared/symbol-declarations.js';

export const batchFindReferencesSchema = z.object({
  queries: z
    .array(
      z.object({
        filePath: z.string().min(1),
        symbol: z.string().min(1),
      }),
    )
    .min(1, 'At least one query must be provided'),
  stopOnError: z.boolean().optional(),
});

export class BatchFindReferencesOperation {
  constructor(
    private finder: SymbolDeclarationFinder,
    private findReferences: FindReferencesOperation,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchFindReferencesSchema.parse(input);
      const results: BatchItemResult[] = [];

      for (const query of validated.queries) {
        try {
          const declaration = await this.finder.findRequiredDeclaration(
            query.filePath,
            query.symbol,
          );
          const result = await this.findReferences.execute({
            filePath: query.filePath,
            line: declaration.startLine,
            text: query.symbol,
          });
          results.push({
            item: query.symbol,
            success: result.success,
            message: result.message,
            filesChanged: [],
          });
          if (!result.success && validated.stopOnError) break;
        } catch (error) {
          results.push({
            item: query.symbol,
            success: false,
            message: error instanceof Error ? error.message : String(error),
            filesChanged: [],
          });
          if (validated.stopOnError) break;
        }
      }

      return {
        success: results.every((result) => result.success),
        message: `Found references for ${results.filter((result) => result.success).length}/${validated.queries.length} symbol(s)`,
        filesChanged: [],
        data: { results },
      };
    } catch (error) {
      if (error instanceof z.ZodError) return formatValidationError(error);
      return {
        success: false,
        message: `Batch find references failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }
}
