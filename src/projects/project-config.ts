import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

export const PROJECT_CONFIG_PATH_ENV = 'MCP_PROJECTS_CONFIG';
export const DEFAULT_PROJECT_CONFIG_PATH = resolve(
  homedir(),
  '.codex',
  'mcp-projects.json',
);

const projectConfigSchema = z.object({
  projects: z.record(z.string().min(1), z.string().min(1)),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export function getProjectConfigPath(): string {
  return process.env[PROJECT_CONFIG_PATH_ENV] ?? DEFAULT_PROJECT_CONFIG_PATH;
}

export function resolveProjectCwd(
  projectName?: string,
  defaultCwd: string = process.cwd(),
): string {
  if (!projectName) {
    return defaultCwd;
  }

  const configPath = getProjectConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(
      `Project "${projectName}" was requested, but config file was not found at ${configPath}. Set ${PROJECT_CONFIG_PATH_ENV} to use a different config file.`,
    );
  }

  const parsedConfig = projectConfigSchema.parse(
    JSON.parse(readFileSync(configPath, 'utf8')),
  );
  const configuredPath = parsedConfig.projects[projectName];

  if (!configuredPath) {
    throw new Error(
      `Project "${projectName}" is not defined in ${configPath}.`,
    );
  }

  if (!isAbsolute(configuredPath)) {
    throw new Error(
      `Project "${projectName}" must map to an absolute path, but got "${configuredPath}".`,
    );
  }

  if (!existsSync(configuredPath)) {
    throw new Error(
      `Project "${projectName}" maps to "${configuredPath}", but that directory does not exist.`,
    );
  }

  return configuredPath;
}
