import fs from 'fs';
import resolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import eslint from '@rollup/plugin-eslint';

const common = {
  context: 'window',
  plugins: [
    resolve(),
    eslint({ overrideConfigFile: './eslint.config.js' }),
    babel({
      babelHelpers: 'bundled',
      comments: false,
      sourceMaps: false,
      plugins: [
        ['@babel/plugin-proposal-class-properties', { loose: true }],
        '@babel/plugin-proposal-optional-chaining',
        [
          'babel-plugin-transform-replace-expressions',
          {
            replace: {
              'globalThis.BARDETECTION_EDGE_RANGE': '32',
            },
          },
        ],
      ],
    }),
  ],
};

const scripts = ['background', 'content', 'content-main', 'diagnostics-page'];

export default scripts.map((script) => ({
  ...common,
  input: `./src/scripts/${script}.js`,
  output: {
    file: `./dist/scripts/${script}.js`,
    format: 'iife',
    sourcemap: false,
    intro: fs
      .readFileSync('./src/scripts/intros/console.js', 'utf8')
      .replaceAll(/.*\/\/ eslint-disable.*/g, ''),
  },
}));
