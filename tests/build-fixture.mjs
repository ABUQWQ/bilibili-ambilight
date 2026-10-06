import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';

const bundle = await rollup({
  input: 'tests/menu-fixture.js',
  context: 'window',
  plugins: [resolve()],
});
const { output } = await bundle.generate({ format: 'iife' });
process.stdout.write(output[0].code);
await bundle.close();
