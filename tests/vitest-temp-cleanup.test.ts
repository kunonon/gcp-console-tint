// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));

describe('Vitest temporary directory cleanup', () => {
  it.each([
    { outcome: 'passes', exitCode: 0, assertion: 'expect(true).toBe(true);' },
    { outcome: 'fails', exitCode: 1, assertion: 'expect(true).toBe(false);' },
  ])(
    'cleans temporary files when a test $outcome',
    async ({ exitCode, assertion }) => {
      const sandbox = await mkdtemp(join(tmpdir(), 'vitest-temp-cleanup-'));
      const fixture = join(sandbox, 'fixture');
      const temporaryFiles = join(sandbox, 'tmp');

      try {
        await mkdir(fixture);
        await mkdir(temporaryFiles);
        const sentinel = join(temporaryFiles, 'sentinel.txt');
        await writeFile(sentinel, 'keep');
        await writeFile(join(fixture, 'basic.test.js'), `test('fixture', () => { ${assertion} });`);

        const result = spawnSync(
          process.execPath,
          [vitestCli, 'run', '--root', fixture, '--globals', '--pool', 'forks'],
          {
            cwd: fixture,
            encoding: 'utf8',
            env: {
              ...process.env,
              FORCE_COLOR: '0',
              NO_COLOR: '1',
              TMP: temporaryFiles,
              TEMP: temporaryFiles,
              TMPDIR: temporaryFiles,
            },
            timeout: 10_000,
          },
        );

        const output = result.stdout + result.stderr;
        expect(result.error).toBeUndefined();
        expect(result.status, output).toBe(exitCode);
        expect(output).toMatch(exitCode === 0 ? /Tests\s+1 passed/ : /Tests\s+1 failed/);
        expect(await readdir(temporaryFiles)).toEqual(['sentinel.txt']);
        expect(await readFile(sentinel, 'utf8')).toBe('keep');
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
