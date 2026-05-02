import { OperationRegistry } from '../registry.js';
import { resolveProjectCwd } from './project-config.js';

export class OperationRegistryCache {
  private registries = new Map<string, Promise<OperationRegistry>>();

  async get(projectName?: string): Promise<OperationRegistry> {
    const cwd = resolveProjectCwd(projectName);
    let registryPromise = this.registries.get(cwd);

    if (!registryPromise) {
      registryPromise = this.createInitializedRegistry(cwd);
      registryPromise.catch(() => {
        this.registries.delete(cwd);
      });
      this.registries.set(cwd, registryPromise);
    }

    return await registryPromise;
  }

  async close(): Promise<void> {
    const registries = await Promise.all(this.registries.values());
    await Promise.all(registries.map((registry) => registry.close()));
    this.registries.clear();
  }

  private async createInitializedRegistry(
    cwd: string,
  ): Promise<OperationRegistry> {
    const registry = new OperationRegistry({ cwd });
    await registry.initialize();
    return registry;
  }
}
