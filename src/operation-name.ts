/**
 * Operation names enum
 * Single source of truth for all operation identifiers
 */

export enum OperationName {
  RENAME = 'rename',
  RENAME_FILE = 'rename_file',
  MOVE_FILE = 'move_file',
  BATCH_MOVE_FILES = 'batch_move_files',
  BATCH_MOVE_SYMBOLS = 'batch_move_symbols',
  ORGANIZE_IMPORTS = 'organize_imports',
  BATCH_ORGANIZE_IMPORTS = 'batch_organize_imports',
  CHECK_REFACTOR_ARTIFACTS = 'check_refactor_artifacts',
  FIX_ALL = 'fix_all',
  REMOVE_UNUSED = 'remove_unused',
  FIND_REFERENCES = 'find_references',
  BATCH_FIND_REFERENCES = 'batch_find_references',
  FIND_SYMBOL_DECLARATIONS = 'find_symbol_declarations',
  EXTRACT_FUNCTION = 'extract_function',
  EXTRACT_CONSTANT = 'extract_constant',
  EXTRACT_VARIABLE = 'extract_variable',
  BATCH_RENAME_SYMBOLS = 'batch_rename_symbols',
  MOVE_TO_FILE = 'move_to_file',
  INFER_RETURN_TYPE = 'infer_return_type',
  REFACTOR_MODULE = 'refactor_module',
  CLEANUP_CODEBASE = 'cleanup_codebase',
  MINIMIZE_EXPORTS = 'minimize_exports',
  RESTART_TSSERVER = 'restart_tsserver',
}
