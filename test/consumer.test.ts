import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a strict consumer typechecks and runs the package from node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'magiclink-consumer-'));
  const pkg = join(root, 'node_modules', '@facile', 'magiclink');
  mkdirSync(pkg, { recursive: true });
  cpSync(join(import.meta.dir, '..', 'src'), join(pkg, 'src'), { recursive: true });
  cpSync(join(import.meta.dir, '..', 'package.json'), join(pkg, 'package.json'));
  symlinkSync(join(import.meta.dir, '..', 'node_modules', 'typescript'), join(root, 'node_modules', 'typescript'));
  symlinkSync(join(import.meta.dir, '..', 'node_modules', '@types'), join(root, 'node_modules', '@types'));
  writeFileSync(
    join(root, 'index.ts'),
    "import { createMagicLinks, createMemoryStore, type MagicLinkStore } from '@facile/magiclink';\n" +
      'const store: MagicLinkStore = createMemoryStore();\n' +
      'export const m = createMagicLinks({}, { store, findUserByEmail: async () => null, send: async () => {}, buildLink: (t) => t });\n'
  );
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true,
        types: ['bun'], exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, verbatimModuleSyntax: true,
      },
      include: ['index.ts'],
    })
  );
  const tsc = Bun.spawnSync([join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', root]);
  expect(tsc.stdout.toString() + tsc.stderr.toString()).toBe('');
  const run = Bun.spawnSync(['bun', join(root, 'index.ts')]);
  expect(run.exitCode).toBe(0);
});
