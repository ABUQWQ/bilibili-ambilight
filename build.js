import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

const run = (file, args) => {
  const result = spawnSync(process.execPath, [file, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

mkdirSync('dist/styles', { recursive: true });
mkdirSync('dist/scripts', { recursive: true });
mkdirSync('dist/images', { recursive: true });

run('node_modules/rollup/dist/bin/rollup', ['-c']);
run('node_modules/sass/sass.js', [
  '--no-source-map',
  'src/styles/content.scss',
  'dist/styles/content.css',
]);

cpSync('src/styles/options.css', 'dist/styles/options.css');
cpSync('src/options.html', 'dist/options.html');
cpSync('src/images', 'dist/images', { recursive: true });

await import('./manifest-copy.js');
