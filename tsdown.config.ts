import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const id = manifest.name
const production = [...new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {}),
])].sort().map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`))

function matchesProduction(specifier: string): boolean {
  return production.some(pattern => pattern.test(specifier))
}

const clientExternals = new Set(['react', 'react/jsx-runtime', 'react-dom'])

export default [{
  name: id,
  entry: ['lib/types/dsh-web-search-firecrawl.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => matchesProduction(specifier),
    alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !matchesProduction(specifier),
  },
}, {
  name: `${id}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => clientExternals.has(specifier),
    alwaysBundle: (specifier: string) => !clientExternals.has(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}]
