import type { TypeScriptServer } from '../../language-servers/typescript/tsserver-client.js';
import { BatchMoveFilesOperation } from '../batch-move-files.js';
import { CleanupCodebaseOperation } from '../cleanup-codebase.js';
import { ExtractConstantOperation } from '../extract-constant.js';
import { ExtractFunctionOperation } from '../extract-function.js';
import { ExtractVariableOperation } from '../extract-variable.js';
import { FindReferencesOperation } from '../find-references.js';
import { FixAllOperation } from '../fix-all.js';
import { InferReturnTypeOperation } from '../infer-return-type.js';
import { MoveFileOperation } from '../move-file.js';
import { MoveToFileOperation } from '../move-to-file.js';
import { OrganizeImportsOperation } from '../organize-imports.js';
import { RefactorModuleOperation } from '../refactor-module.js';
import { RefactoringProcessor } from '../refactoring-processor.js';
import { RemoveUnusedOperation } from '../remove-unused.js';
import { RenameOperation } from '../rename.js';
import { RenameFileOperation } from '../rename-file.js';
import { RestartTsServerOperation } from '../restart-tsserver.js';
import { EditApplicator } from './edit-applicator.js';
import { FileDiscovery } from './file-discovery.js';
import { FileMover } from './file-mover.js';
import { FileOperations } from './file-operations.js';
import { FormatConfigurator } from './format-configurator.js';
import { IndentationDetector } from './indentation-detector.js';
import { TextPositionConverter } from './text-position-converter.js';
import { TSServerGuard } from './tsserver-guard.js';

export function createRenameFileOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  const fileOps = new FileOperations(cwd);
  return new RenameFileOperation(
    new TSServerGuard(tsServer, cwd),
    new FileDiscovery(tsServer),
    new FileMover(tsServer, fileOps),
    fileOps,
  );
}

export function createMoveFileOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  const fileOps = new FileOperations(cwd);
  return new MoveFileOperation(
    new TSServerGuard(tsServer, cwd),
    new FileDiscovery(tsServer),
    new FileMover(tsServer, fileOps),
    fileOps,
  );
}

export function createBatchMoveFilesOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  const fileOps = new FileOperations(cwd);
  return new BatchMoveFilesOperation(
    new TSServerGuard(tsServer, cwd),
    new FileDiscovery(tsServer),
    new FileMover(tsServer, fileOps),
    fileOps,
  );
}

export function createRenameOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new RenameOperation(
    tsServer,
    new FileOperations(cwd),
    new TextPositionConverter(),
    new EditApplicator(),
    new TSServerGuard(tsServer, cwd),
    new FileDiscovery(tsServer),
  );
}

export function createOrganizeImportsOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new OrganizeImportsOperation(
    tsServer,
    new FileOperations(cwd),
    new EditApplicator(),
    new FormatConfigurator(tsServer, new IndentationDetector()),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createFixAllOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new FixAllOperation(
    tsServer,
    new FileOperations(cwd),
    new EditApplicator(),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createRemoveUnusedOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new RemoveUnusedOperation(
    tsServer,
    new FileOperations(cwd),
    new EditApplicator(),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createFindReferencesOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new FindReferencesOperation(
    tsServer,
    new FileOperations(cwd),
    new TextPositionConverter(),
    new TSServerGuard(tsServer, cwd),
    new FileDiscovery(tsServer),
  );
}

export function createExtractFunctionOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new ExtractFunctionOperation(
    tsServer,
    new RefactoringProcessor('function'),
    new FileOperations(cwd),
    new TextPositionConverter(),
    new EditApplicator(),
    new FormatConfigurator(tsServer, new IndentationDetector()),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createExtractConstantOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new ExtractConstantOperation(
    tsServer,
    new RefactoringProcessor('const'),
    new FileOperations(cwd),
    new TextPositionConverter(),
    new EditApplicator(),
    new FormatConfigurator(tsServer, new IndentationDetector()),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createExtractVariableOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new ExtractVariableOperation(
    tsServer,
    new RefactoringProcessor('const'),
    new FileOperations(cwd),
    new TextPositionConverter(),
    new EditApplicator(),
    new FormatConfigurator(tsServer, new IndentationDetector()),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createMoveToFileOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new MoveToFileOperation(
    tsServer,
    new FileOperations(cwd),
    new TextPositionConverter(),
    new EditApplicator(),
    new FormatConfigurator(tsServer, new IndentationDetector()),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createInferReturnTypeOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new InferReturnTypeOperation(
    tsServer,
    new FileOperations(cwd),
    new TextPositionConverter(),
    new EditApplicator(),
    new TSServerGuard(tsServer, cwd),
  );
}

export function createRefactorModuleOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new RefactorModuleOperation(
    new TSServerGuard(tsServer, cwd),
    createMoveFileOperation(tsServer, cwd),
    createOrganizeImportsOperation(tsServer, cwd),
    createFixAllOperation(tsServer, cwd),
    new FileOperations(cwd),
  );
}

export function createCleanupCodebaseOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new CleanupCodebaseOperation(
    new TSServerGuard(tsServer, cwd),
    createOrganizeImportsOperation(tsServer, cwd),
    new FileOperations(cwd),
  );
}

export function createRestartTsServerOperation(
  tsServer: TypeScriptServer,
  cwd: string = process.cwd(),
) {
  return new RestartTsServerOperation(tsServer, cwd);
}
