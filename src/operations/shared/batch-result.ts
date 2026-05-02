import { normalize } from 'node:path';
import type { RefactorResult } from '../../language-servers/typescript/tsserver-client.js';

export interface BatchItemResult {
  item: string;
  success: boolean;
  message: string;
  filesChanged: RefactorResult['filesChanged'];
}

export function mergeFilesChanged(
  target: RefactorResult['filesChanged'],
  additions: RefactorResult['filesChanged'],
): void {
  for (const fileChange of additions) {
    const existing = target.find(
      (entry) => normalize(entry.path) === normalize(fileChange.path),
    );
    if (existing) {
      existing.edits.push(...fileChange.edits);
    } else {
      target.push(fileChange);
    }
  }
}
