import { basename, normalize } from 'node:path';
import ts from 'typescript';
import type { FileOperations } from './file-operations.js';

export const symbolKindValues = [
  'function',
  'const',
  'let',
  'var',
  'type',
  'interface',
  'class',
  'enum',
  'any',
] as const;

export type SymbolKind = (typeof symbolKindValues)[number];

export interface SymbolDependency {
  name: string;
  moduleSpecifier: string;
}

export interface SymbolDeclaration {
  symbol: string;
  kind: Exclude<SymbolKind, 'any'>;
  exported: boolean;
  filePath: string;
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  dependencies: SymbolDependency[];
}

interface ImportBinding {
  name: string;
  moduleSpecifier: string;
}

export class SymbolDeclarationFinder {
  constructor(private fileOps: FileOperations) {}

  async findDeclarations(
    filePath: string,
    symbols?: string[],
    symbolKind: SymbolKind = 'any',
  ): Promise<SymbolDeclaration[]> {
    const resolvedPath = this.fileOps.resolvePath(filePath);
    const content = (await this.fileOps.readLines(resolvedPath)).join('\n');
    const sourceFile = ts.createSourceFile(
      resolvedPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      resolvedPath.endsWith('.tsx') || resolvedPath.endsWith('.jsx')
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS,
    );
    const imports = this.collectImports(sourceFile);
    const wantedSymbols = symbols ? new Set(symbols) : undefined;
    const declarations: SymbolDeclaration[] = [];

    for (const statement of sourceFile.statements) {
      declarations.push(
        ...this.getStatementDeclarations(
          statement,
          sourceFile,
          resolvedPath,
          imports,
        ),
      );
    }

    return declarations.filter((declaration) => {
      if (wantedSymbols && !wantedSymbols.has(declaration.symbol)) return false;
      if (symbolKind !== 'any' && declaration.kind !== symbolKind) return false;
      return true;
    });
  }

  async findRequiredDeclaration(
    filePath: string,
    symbol: string,
    symbolKind: SymbolKind = 'any',
  ): Promise<SymbolDeclaration> {
    const declarations = await this.findDeclarations(
      filePath,
      [symbol],
      symbolKind,
    );
    const declaration = declarations[0];
    if (!declaration) {
      throw new Error(`Symbol "${symbol}" was not found in ${filePath}`);
    }
    return declaration;
  }

  private getStatementDeclarations(
    statement: ts.Statement,
    sourceFile: ts.SourceFile,
    filePath: string,
    imports: ImportBinding[],
  ): SymbolDeclaration[] {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      return [
        this.createDeclaration(
          statement.name.text,
          'function',
          statement,
          statement.name,
          sourceFile,
          filePath,
          imports,
        ),
      ];
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      return [
        this.createDeclaration(
          statement.name.text,
          'class',
          statement,
          statement.name,
          sourceFile,
          filePath,
          imports,
        ),
      ];
    }

    if (ts.isInterfaceDeclaration(statement)) {
      return [
        this.createDeclaration(
          statement.name.text,
          'interface',
          statement,
          statement.name,
          sourceFile,
          filePath,
          imports,
        ),
      ];
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      return [
        this.createDeclaration(
          statement.name.text,
          'type',
          statement,
          statement.name,
          sourceFile,
          filePath,
          imports,
        ),
      ];
    }

    if (ts.isEnumDeclaration(statement)) {
      return [
        this.createDeclaration(
          statement.name.text,
          'enum',
          statement,
          statement.name,
          sourceFile,
          filePath,
          imports,
        ),
      ];
    }

    if (ts.isVariableStatement(statement)) {
      const kind = this.getVariableStatementKind(statement);
      return statement.declarationList.declarations
        .filter(
          (
            declaration,
          ): declaration is ts.VariableDeclaration & {
            name: ts.Identifier;
          } => ts.isIdentifier(declaration.name),
        )
        .map((declaration) =>
          this.createDeclaration(
            declaration.name.text,
            kind,
            statement,
            declaration.name,
            sourceFile,
            filePath,
            imports,
          ),
        );
    }

    return [];
  }

  private createDeclaration(
    symbol: string,
    kind: Exclude<SymbolKind, 'any'>,
    statement: ts.Node,
    nameNode: ts.Identifier,
    sourceFile: ts.SourceFile,
    filePath: string,
    imports: ImportBinding[],
  ): SymbolDeclaration {
    const start = sourceFile.getLineAndCharacterOfPosition(
      nameNode.getStart(sourceFile),
    );
    const end = sourceFile.getLineAndCharacterOfPosition(nameNode.getEnd());
    const statementText = statement.getText(sourceFile);

    return {
      symbol,
      kind,
      exported: this.isExported(statement),
      filePath: normalize(filePath),
      file: basename(filePath),
      startLine: start.line + 1,
      startColumn: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      dependencies: this.collectUsedImports(statementText, imports),
    };
  }

  private collectImports(sourceFile: ts.SourceFile): ImportBinding[] {
    const imports: ImportBinding[] = [];

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

      const moduleSpecifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) continue;

      if (clause.name) {
        imports.push({ name: clause.name.text, moduleSpecifier });
      }

      const namedBindings = clause.namedBindings;
      if (!namedBindings) continue;

      if (ts.isNamespaceImport(namedBindings)) {
        imports.push({ name: namedBindings.name.text, moduleSpecifier });
        continue;
      }

      for (const element of namedBindings.elements) {
        imports.push({ name: element.name.text, moduleSpecifier });
      }
    }

    return imports;
  }

  private collectUsedImports(
    statementText: string,
    imports: ImportBinding[],
  ): SymbolDependency[] {
    return imports
      .filter((binding) =>
        new RegExp(`\\b${this.escapeRegExp(binding.name)}\\b`).test(
          statementText,
        ),
      )
      .map((binding) => ({
        name: binding.name,
        moduleSpecifier: binding.moduleSpecifier,
      }));
  }

  private isExported(node: ts.Node): boolean {
    return (
      ts.canHaveModifiers(node) &&
      !!ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    );
  }

  private getVariableStatementKind(
    statement: ts.VariableStatement,
  ): 'const' | 'let' | 'var' {
    const flags = statement.declarationList.flags;
    if ((flags & ts.NodeFlags.Const) !== 0) return 'const';
    if ((flags & ts.NodeFlags.Let) !== 0) return 'let';
    return 'var';
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
