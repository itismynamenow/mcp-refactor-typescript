import { readFile } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  resolve,
} from 'node:path';
import { z } from 'zod';
import type { RefactorResult } from '../language-servers/typescript/tsserver-client.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { FileOperations } from './shared/file-operations.js';

const artifactChecks = [
  'undefined-imports',
  'type-type',
  'self-imports',
  'type-only-runtime-imports',
  'deep-facade-imports',
] as const;

type ArtifactCheck = (typeof artifactChecks)[number];

interface ArtifactFinding {
  check: ArtifactCheck;
  file: string;
  path: string;
  line: number;
  message: string;
  text: string;
}

export const checkRefactorArtifactsSchema = z.object({
  filePaths: z.array(z.string().min(1)).min(1),
  checks: z.array(z.enum(artifactChecks)).optional(),
  facadePaths: z.array(z.string().min(1)).optional(),
});

export class CheckRefactorArtifactsOperation {
  constructor(private fileOps: FileOperations) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = checkRefactorArtifactsSchema.parse(input);
      const checks = new Set<ArtifactCheck>(
        validated.checks ?? [...artifactChecks],
      );
      const facadePaths = new Set(
        (validated.facadePaths ?? []).map((path) =>
          normalize(this.fileOps.resolvePath(path)),
        ),
      );
      const findings: ArtifactFinding[] = [];

      for (const filePath of validated.filePaths) {
        const resolvedPath = this.fileOps.resolvePath(filePath);
        const content = await readFile(resolvedPath, 'utf-8');
        findings.push(
          ...this.findArtifacts(resolvedPath, content, checks, facadePaths),
        );
      }

      return {
        success: findings.length === 0,
        message:
          findings.length === 0
            ? 'No refactor artifacts found'
            : `Found ${findings.length} refactor artifact(s)`,
        filesChanged: [],
        data: { findings },
      };
    } catch (error) {
      if (error instanceof z.ZodError) return formatValidationError(error);
      return {
        success: false,
        message: `Check refactor artifacts failed: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: [],
      };
    }
  }

  private findArtifacts(
    filePath: string,
    content: string,
    checks: Set<ArtifactCheck>,
    facadePaths: Set<string>,
  ): ArtifactFinding[] {
    const findings: ArtifactFinding[] = [];

    if (checks.has('undefined-imports')) {
      for (const match of content.matchAll(
        /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+(['"])([^'"]+)\3\s*;?/g,
      )) {
        const imports = this.parseNamedImports(match[2] ?? '');
        if (
          imports.some(
            (imported) => this.getImportedName(imported) === 'undefined',
          )
        ) {
          findings.push(
            this.createFinding(
              'undefined-imports',
              filePath,
              content,
              match.index ?? 0,
              'Import contains generated undefined specifier',
              match[0],
            ),
          );
        }
      }
    }

    if (checks.has('type-type')) {
      for (const match of content.matchAll(/\btype\s+type\b/g)) {
        findings.push(
          this.createFinding(
            'type-type',
            filePath,
            content,
            match.index ?? 0,
            'Import contains duplicated type modifier',
            match[0],
          ),
        );
      }
    }

    if (
      checks.has('self-imports') ||
      checks.has('type-only-runtime-imports') ||
      checks.has('deep-facade-imports')
    ) {
      this.visitImports(content, (importInfo) => {
        if (
          checks.has('self-imports') &&
          this.moduleSpecifierTargetsFile(
            filePath,
            importInfo.moduleSpecifier,
            filePath,
          )
        ) {
          findings.push(
            this.createFinding(
              'self-imports',
              filePath,
              content,
              importInfo.index,
              'Import targets the same file',
              importInfo.text,
            ),
          );
        }

        if (
          checks.has('deep-facade-imports') &&
          this.targetsFacadeChild(
            filePath,
            importInfo.moduleSpecifier,
            facadePaths,
          )
        ) {
          findings.push(
            this.createFinding(
              'deep-facade-imports',
              filePath,
              content,
              importInfo.index,
              'Import targets a child file under a configured facade',
              importInfo.text,
            ),
          );
        }

        if (!checks.has('type-only-runtime-imports')) return;

        const bodyWithoutImports = content.replace(
          /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+(['"])([^'"]+)\3\s*;?/g,
          '',
        );
        for (const imported of importInfo.imports) {
          const importedName = this.getImportedName(imported);
          if (!importedName) continue;
          if (!this.isTypeOnlySpecifier(importInfo.typeOnly, imported))
            continue;
          if (!this.isUsedAsRuntimeValue(bodyWithoutImports, importedName))
            continue;

          findings.push(
            this.createFinding(
              'type-only-runtime-imports',
              filePath,
              content,
              importInfo.index,
              `Type-only import "${importedName}" is used as a runtime value`,
              importInfo.text,
            ),
          );
        }
      });
    }

    return findings;
  }

  private visitImports(
    content: string,
    visitor: (importInfo: {
      text: string;
      index: number;
      typeOnly: boolean;
      imports: string[];
      moduleSpecifier: string;
    }) => void,
  ): void {
    const importPattern =
      /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+(['"])([^'"]+)\3\s*;?/g;

    for (const match of content.matchAll(importPattern)) {
      visitor({
        text: match[0],
        index: match.index ?? 0,
        typeOnly: !!match[1],
        imports: this.parseNamedImports(match[2] ?? ''),
        moduleSpecifier: match[4] ?? '',
      });
    }
  }

  private createFinding(
    check: ArtifactCheck,
    filePath: string,
    content: string,
    index: number,
    message: string,
    text: string,
  ): ArtifactFinding {
    return {
      check,
      file: basename(filePath),
      path: filePath,
      line: content.slice(0, index).split('\n').length,
      message,
      text,
    };
  }

  private parseNamedImports(namedImports: string): string[] {
    return namedImports
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private getImportedName(importedSymbol: string): string | undefined {
    return importedSymbol
      .replace(/^type\s+/, '')
      .split(/\s+as\s+/)[0]
      ?.trim();
  }

  private isTypeOnlySpecifier(
    importIsTypeOnly: boolean,
    importedSymbol: string,
  ): boolean {
    return importIsTypeOnly || importedSymbol.trim().startsWith('type ');
  }

  private isUsedAsRuntimeValue(content: string, importedName: string): boolean {
    const escapedName = importedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `(?:\\bnew\\s+${escapedName}\\b|\\binstanceof\\s+${escapedName}\\b|\\b${escapedName}\\s*[.(])`,
    ).test(content);
  }

  private targetsFacadeChild(
    importerPath: string,
    moduleSpecifier: string,
    facadePaths: Set<string>,
  ): boolean {
    if (!moduleSpecifier.startsWith('.')) return false;

    const targetPath = this.resolveModuleSpecifier(
      importerPath,
      moduleSpecifier,
    );

    for (const facadePath of facadePaths) {
      const extension = extname(facadePath);
      const facadeStem = extension
        ? facadePath.slice(0, -extension.length)
        : facadePath;
      const facadeRoot =
        basename(facadeStem) === 'index' ? dirname(facadeStem) : facadeStem;
      if (
        normalize(targetPath).startsWith(
          `${normalize(facadeRoot)}${normalize('/')}`,
        ) &&
        normalize(targetPath) !== normalize(facadeStem)
      ) {
        return true;
      }
    }

    return false;
  }

  private moduleSpecifierTargetsFile(
    importerPath: string,
    moduleSpecifier: string,
    targetFile: string,
  ): boolean {
    if (!moduleSpecifier.startsWith('.')) return false;

    const basePath = resolve(dirname(importerPath), moduleSpecifier);
    const extension = extname(basePath);
    const extensionlessPath = extension
      ? basePath.slice(0, -extension.length)
      : basePath;
    const candidates = [
      basePath,
      extensionlessPath,
      `${extensionlessPath}.ts`,
      `${extensionlessPath}.tsx`,
      `${extensionlessPath}.js`,
      `${extensionlessPath}.jsx`,
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

  private resolveModuleSpecifier(
    importerPath: string,
    moduleSpecifier: string,
  ): string {
    return resolve(dirname(importerPath), moduleSpecifier);
  }
}
