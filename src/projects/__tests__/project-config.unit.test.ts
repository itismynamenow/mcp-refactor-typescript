import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT_CONFIG_PATH_ENV,
  resolveProjectCwd,
} from '../project-config.js';

describe('project config resolution', () => {
  const originalConfigPath = process.env[PROJECT_CONFIG_PATH_ENV];
  const createdDirs: string[] = [];

  afterEach(async () => {
    if (originalConfigPath === undefined) {
      delete process.env[PROJECT_CONFIG_PATH_ENV];
    } else {
      process.env[PROJECT_CONFIG_PATH_ENV] = originalConfigPath;
    }

    await Promise.all(
      createdDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('uses the default cwd when projectName is omitted', () => {
    expect(resolveProjectCwd(undefined, 'C:\\fallback')).toBe('C:\\fallback');
  });

  it('resolves projectName through the configured JSON file', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mcp-projects-'));
    createdDirs.push(fixtureRoot);
    const projectDir = join(fixtureRoot, 'project-a');
    const configPath = join(fixtureRoot, 'projects.json');

    await mkdir(projectDir);
    await writeFile(
      configPath,
      JSON.stringify({ projects: { alpha: projectDir } }),
      'utf8',
    );
    process.env[PROJECT_CONFIG_PATH_ENV] = configPath;

    expect(resolveProjectCwd('alpha', 'ignored')).toBe(projectDir);
  });

  it('rejects unknown project names', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mcp-projects-'));
    createdDirs.push(fixtureRoot);
    const configPath = join(fixtureRoot, 'projects.json');

    await writeFile(configPath, JSON.stringify({ projects: {} }), 'utf8');
    process.env[PROJECT_CONFIG_PATH_ENV] = configPath;

    expect(() => resolveProjectCwd('missing', 'ignored')).toThrow(
      /not defined/,
    );
  });

  it('rejects relative configured project paths', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mcp-projects-'));
    createdDirs.push(fixtureRoot);
    const configPath = join(fixtureRoot, 'projects.json');

    await writeFile(
      configPath,
      JSON.stringify({ projects: { alpha: 'relative/path' } }),
      'utf8',
    );
    process.env[PROJECT_CONFIG_PATH_ENV] = configPath;

    expect(() => resolveProjectCwd('alpha', 'ignored')).toThrow(
      /absolute path/,
    );
  });
});
