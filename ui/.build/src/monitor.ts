import fs from 'node:fs';
import path from 'node:path';
import ps from 'node:process';
import { build, stopBuild } from './build.ts';
import { env } from './main.ts';
import { clean } from './clean.ts';
import { globArray } from './parse.ts';
import { stopTsc, tsc } from './tsc.ts';
import { stopEsbuild, esbuild } from './esbuild.ts';

const watchers: fs.FSWatcher[] = [];

let packageTimeout: NodeJS.Timeout | undefined;
let tscTimeout: NodeJS.Timeout | undefined;

export function stopMonitor(): void {
  for (const w of watchers) w.close();
  watchers.length = 0;
  clearTimeout(tscTimeout);
  clearTimeout(packageTimeout);
  tscTimeout = packageTimeout = undefined;
}

export async function monitor(pkgs: string[]): Promise<void> {
  if (!env.watch) return;
  const [typePkgs, typings] = await Promise.all([
    globArray('*/package.json', { cwd: env.typesDir }),
    globArray('*/*.d.ts', { cwd: env.typesDir }),
  ]);
  const tscChange = async () => {
    if (packageTimeout) return;
    await stopTsc();
    await stopEsbuild();
    clearTimeout(tscTimeout);
    tscTimeout = setTimeout(() => {
      if (packageTimeout) return;
      tsc().then(esbuild);
    }, 2000);
  };
  const packageChange = async () => {
    if (env.watch && env.install) {
      clearTimeout(tscTimeout);
      clearTimeout(packageTimeout);
      await stopBuild();
      packageTimeout = setTimeout(() => clean().then(() => build(pkgs)), 2000);
      return;
    }
    env.warn('Exiting due to package.json change');
    ps.exit(0);
  };

  watchers.push(fs.watch(path.join(env.rootDir, 'package.json'), packageChange));
  for (const p of typePkgs) watchers.push(fs.watch(p, packageChange));
  for (const t of typings) watchers.push(fs.watch(t, tscChange));
  for (const pkg of env.building) {
    watchers.push(fs.watch(path.join(pkg.root, 'package.json'), packageChange));
    watchers.push(fs.watch(path.join(pkg.root, 'tsconfig.json'), tscChange));
  }
}
