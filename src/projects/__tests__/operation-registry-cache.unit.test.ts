import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationRegistryCache } from '../operation-registry-cache.js';
import { PROJECT_CONFIG_PATH_ENV } from '../project-config.js';

describe('OperationRegistryCache', () => {
  const originalConfigPath = process.env[PROJECT_CONFIG_PATH_ENV];
  const createdDirs: string[] = [];
  const caches: OperationRegistryCache[] = [];

  afterEach(async () => {
    await Promise.all(caches.splice(0).map((cache) => cache.close()));

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

  it('caches separate registries per configured project directory', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mcp-registry-cache-'));
    createdDirs.push(fixtureRoot);
    const projectA = join(fixtureRoot, 'project-a');
    const projectB = join(fixtureRoot, 'project-b');
    const configPath = join(fixtureRoot, 'projects.json');

    await mkdir(projectA);
    await mkdir(projectB);
    await writeFile(
      configPath,
      JSON.stringify({
        projects: {
          alpha: projectA,
          beta: projectB,
        },
      }),
      'utf8',
    );
    process.env[PROJECT_CONFIG_PATH_ENV] = configPath;

    const cache = new OperationRegistryCache();
    caches.push(cache);

    const alphaFirst = await cache.get('alpha');
    const alphaSecond = await cache.get('alpha');
    const beta = await cache.get('beta');

    expect(alphaFirst).toBe(alphaSecond);
    expect(alphaFirst).not.toBe(beta);
    expect(alphaFirst.getCwd()).toBe(projectA);
    expect(beta.getCwd()).toBe(projectB);
  });
});
