import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import packageJson from './package.json' with { type: 'json' };

if(!existsSync('dist')) mkdirSync('dist');
const manifestPath = 'dist/manifest.json';
const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
manifest.version = packageJson.version;

if (process.env.BILIBILI_AMBIENTLIGHT_DIAGNOSTICS !== '1') {
  manifest.content_scripts = manifest.content_scripts.filter(
    (entry) => !entry.js?.includes('scripts/diagnostics-page.js')
  );
}

copyFileSync('src/manifest.json', manifestPath);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
