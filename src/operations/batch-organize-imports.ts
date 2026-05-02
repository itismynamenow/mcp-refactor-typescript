import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { OrganizeImportsOperation } from './organize-imports.js';
import {
  type BatchItemResult,
  mergeFilesChanged,
} from './shared/batch-result.js';

export const batchOrganizeImportsSchema = z.object({
  filePaths: z
    .array(z.string().min(1))
    .min(1, 'At least one file path must be provided'),
  preview: z.boolean().optional(),
  stopOnError: z.boolean().optional(),
  responseMode: z.enum(['summary', 'full']).optional(),
});

export class BatchOrganizeImportsOperation {
  constructor(private organizeImports: OrganizeImportsOperation) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = batchOrganizeImportsSchema.parse(input);
      const results: BatchItemResult[] = [];
      const filesChanged: RefactorResult['filesChanged'] = [];
      let successCount = 0;

      for (const filePath of validated.filePaths) {
        const result = await this.organizeImports.execute({
          filePath,
          preview: validated.preview,
        });
        results.push({
          item: filePath,
          success: result.success,
          message: result.message,
          filesChanged: result.filesChanged,
        });
        if (result.success) {
          successCount++;
          mergeFilesChanged(filesChanged, result.filesChanged);
        } else if (validated.stopOnError) {
          break;
        }
      }

      const responseMode = validated.responseMode ?? 'summary';
      const responseFilesChanged =
        responseMode === 'full'
          ? filesChanged
          : filesChanged.map((fileChange) => ({
              file: fileChange.file,
              path: fileChange.path,
              edits: [],
            }));

      return {
        success: results.every((result) => result.success),
        message: `Organized imports for ${successCount}/${validated.filePaths.length} file(s)`,
        filesChanged: responseFilesChanged,
        data:
          responseMode === 'full'
            ? { results }
            : {
                responseMode,
                organized: successCount,
                requested: validated.filePaths.length,
                failed: results
                  .filter((result) => !result.success)
                  .map((result) => ({
                    item: result.item,
                    message: result.message,
                  })),
                filesChanged: responseFilesChanged.map((fileChange) => ({
                  file: fileChange.file,
                  path: fileChange.path,
                })),
              },
      };
    } catch (error) {
      if (error instanceof z.ZodError) return formatValidationError(error);
      return {
        success: false,
        message: `Batch organize imports failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }
}
