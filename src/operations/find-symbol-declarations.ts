import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { FileOperations } from './shared/file-operations.js';
import {
  type SymbolDeclarationFinder,
  symbolKindValues,
} from './shared/symbol-declarations.js';

export const findSymbolDeclarationsSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  symbols: z.array(z.string().min(1)).optional(),
  symbolKind: z.enum(symbolKindValues).optional(),
});

export class FindSymbolDeclarationsOperation {
  constructor(
    private finder: SymbolDeclarationFinder,
    private fileOps: FileOperations,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = findSymbolDeclarationsSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);
      const declarations = await this.finder.findDeclarations(
        filePath,
        validated.symbols,
        validated.symbolKind,
      );

      const message =
        declarations.length === 0
          ? `No matching symbol declaration(s) found in ${filePath}`
          : `Found ${declarations.length} symbol declaration(s):\n${declarations
              .map(
                (declaration) =>
                  `  - ${declaration.symbol} (${declaration.kind}, ${declaration.exported ? 'exported' : 'private'}) at line ${declaration.startLine}`,
              )
              .join('\n')}`;

      return {
        success: true,
        message,
        filesChanged: [],
        data: { declarations },
      };
    } catch (error) {
      if (error instanceof z.ZodError) return formatValidationError(error);
      return {
        success: false,
        message: `Find symbol declarations failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }
}
