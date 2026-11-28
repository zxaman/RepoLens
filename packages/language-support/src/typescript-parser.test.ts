import { STATIC_ANALYSIS_LIMITS } from '@repolens/core';
import { describe, expect, it } from 'vitest';
import { TypeScriptParser } from './typescript-parser.js';

const parser = new TypeScriptParser();

describe('TypeScript Compiler API parser', () => {
  it('extracts normalized declarations with one-based locations and lexical parent keys', () => {
    const parsed = parser.parse(
      'src/model.ts',
      [
        'export interface User {',
        '  id: string;',
        '  greet(value: number): void;',
        '}',
        'export function createUser(name: string) {',
        '  const local = name;',
        '  return { name: local };',
        '}',
      ].join('\n'),
    );
    const symbol = (name: string) => parsed.symbols.find((candidate) => candidate.name === name);
    const user = symbol('User');
    const id = symbol('id');
    const greet = symbol('greet');
    const greetParameter = symbol('value');
    const createUser = symbol('createUser');
    const createUserParameter = symbol('name');
    const local = symbol('local');

    expect(parsed.diagnostics).toEqual([]);
    expect(user).toMatchObject({
      kind: 'interface',
      exported: true,
      location: { filePath: 'src/model.ts', startLine: 1, startColumn: 1 },
    });
    expect(id).toMatchObject({
      kind: 'property',
      parentKey: user?.key,
      location: { startLine: 2, startColumn: 3 },
    });
    expect(greet).toMatchObject({ kind: 'method', parentKey: user?.key });
    expect(greetParameter).toMatchObject({ kind: 'parameter', parentKey: greet?.key });
    expect(createUser).toMatchObject({ kind: 'function', exported: true, parentKey: 'module' });
    expect(createUserParameter).toMatchObject({ kind: 'parameter', parentKey: createUser?.key });
    expect(local).toMatchObject({ kind: 'variable', parentKey: createUser?.key });
    expect(parsed.exports.map((entry) => [entry.name, entry.localName])).toContainEqual([
      'User',
      'User',
    ]);
    expect(parsed.exports.map((entry) => [entry.name, entry.localName])).toContainEqual([
      'createUser',
      'createUser',
    ]);
  });

  it('recognizes static, type-only, dynamic, CommonJS, re-export, and export relationships', () => {
    const parsed = parser.parse(
      'src/relations.ts',
      [
        "import type { Model as M } from './model';",
        "import Default, { item as value, type Shape } from 'pkg/subpath';",
        "import('./lazy');",
        "require('./legacy');",
        "require.resolve('./runtime');",
        "type Imported = import('./types').Imported;",
        'export { value as renamed };',
        "export { item as publicItem } from './public';",
        "export * from './everything';",
        "export * as tools from './tools';",
        'export default function serve() { return value; }',
        'module.exports = value;',
        'exports.ready = true;',
        "exports['dynamic-key'] = true;",
      ].join('\n'),
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.imports.map(({ specifier, kind }) => [specifier, kind])).toEqual([
      ['./model', 'type-only'],
      ['pkg/subpath', 'static'],
      ['./lazy', 'dynamic'],
      ['./legacy', 'commonjs'],
      ['./runtime', 'commonjs-resolve'],
      ['./types', 'type-only'],
      ['./public', 're-export'],
      ['./everything', 're-export'],
      ['./tools', 're-export'],
    ]);
    expect(parsed.imports[1]?.bindings).toEqual([
      { importedName: 'default', localName: 'Default', kind: 'default', isTypeOnly: false },
      { importedName: 'item', localName: 'value', kind: 'named', isTypeOnly: false },
      { importedName: 'Shape', localName: 'Shape', kind: 'named', isTypeOnly: true },
    ]);
    expect(parsed.exports.map(({ name, kind, source }) => [name, kind, source])).toEqual([
      ['renamed', 'named', undefined],
      ['publicItem', 'named', './public'],
      ['*', 'star', './everything'],
      ['tools', 'namespace', './tools'],
      ['default', 'default', undefined],
      ['default', 'commonjs', undefined],
      ['ready', 'commonjs', undefined],
      ['dynamic-key', 'commonjs', undefined],
    ]);
  });

  it('uses TypeScript script kinds for TSX, JSX, JavaScript, and module extensions', () => {
    const fixtures = [
      ['src/component.tsx', 'export const Component = () => <main />;'],
      ['src/component.jsx', 'export const Component = () => <main />;'],
      ['src/script.js', 'export function run() { return 1; }'],
      ['src/script.mjs', 'export const run = () => 1;'],
      ['src/script.cjs', 'module.exports = function run() {};'],
      ['src/types.mts', 'export type Value = string;'],
      ['src/types.cts', 'export interface Value { id: string }'],
    ] as const;

    for (const [filePath, source] of fixtures) {
      const parsed = parser.parse(filePath, source);
      expect(parsed.diagnostics, filePath).toEqual([]);
      expect(parsed.symbols.length, filePath).toBeGreaterThan(1);
    }
  });

  it('tags Angular components and injectables from their real decorators, including aliases', () => {
    const parsed = parser.parse(
      'src/app.component.ts',
      [
        "import { Component as NgComponent, Injectable } from '@angular/core';",
        "import * as ng from '@angular/core';",
        "import type { Component as TypeOnlyComponent } from '@angular/core';",
        '@NgComponent({ selector: "app-root", template: "<main />" })',
        'export class AppComponent {}',
        '@Injectable({ providedIn: "root" })',
        'export class UserService {}',
        '@ng.Component({ selector: "app-dashboard", template: "<main />" })',
        'export class DashboardComponent {}',
        '@Component({ selector: "not-angular" })',
        'export class PlainComponent {}',
        '@TypeOnlyComponent({ selector: "type-only" })',
        'export class TypeOnlyComponentClass {}',
      ].join('\n'),
    );

    expect(parsed.symbols).toContainEqual(
      expect.objectContaining({ name: 'AppComponent', kind: 'class', semanticRole: 'component' }),
    );
    expect(parsed.symbols).toContainEqual(
      expect.objectContaining({ name: 'UserService', kind: 'class', semanticRole: 'service' }),
    );
    expect(parsed.symbols).toContainEqual(
      expect.objectContaining({ name: 'DashboardComponent', semanticRole: 'component' }),
    );
    expect(
      parsed.symbols.find((symbol) => symbol.name === 'PlainComponent')?.semanticRole,
    ).toBeUndefined();
    expect(
      parsed.symbols.find((symbol) => symbol.name === 'TypeOnlyComponentClass')?.semanticRole,
    ).toBeUndefined();
  });

  it('reads JSON-with-comments tsconfig baseUrl, paths, and local extends references', () => {
    const config = parser.parseResolutionConfig(
      'tsconfig.json',
      `{
        // TypeScript supports comments and trailing commas here.
        "compilerOptions": {
          "baseUrl": "./src",
          "paths": { "@/*": ["app/*", "shared/*"], }
        },
      }`,
    );
    expect(config).toEqual({
      resolution: {
        baseUrl: './src',
        paths: [{ pattern: '@/*', targets: ['app/*', 'shared/*'] }],
      },
      diagnostics: [],
    });

    const inherited = parser.parseResolutionConfig(
      'tsconfig.json',
      '{"extends":"./tsconfig.base.json","compilerOptions":{"paths":{"@/*":["src/*"]}}}',
    );
    expect(inherited).toEqual({
      resolution: {
        extends: './tsconfig.base.json',
        paths: [{ pattern: '@/*', targets: ['src/*'] }],
      },
      diagnostics: [],
    });
  });

  it('bounds tsconfig alias mappings and baseUrl length', () => {
    const paths = Object.fromEntries(
      Array.from({ length: STATIC_ANALYSIS_LIMITS.maxTsconfigPathMappings + 1 }, (_, index) => [
        `@alias-${index}/*`,
        ['src/*'],
      ]),
    );
    const parsed = parser.parseResolutionConfig(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: 'src', paths } }),
    );
    expect(parsed.resolution?.paths).toHaveLength(STATIC_ANALYSIS_LIMITS.maxTsconfigPathMappings);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RESULT_LIMIT_REACHED' }),
    );

    const oversizedBase = parser.parseResolutionConfig(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: 'a'.repeat(2_000) } }),
    );
    expect(oversizedBase.resolution?.baseUrl).toBeUndefined();
    expect(oversizedBase.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'TSCONFIG_INVALID' }),
    );
  });

  it('returns structured syntax diagnostics and still extracts recoverable declarations', () => {
    const parsed = parser.parse('src/broken.ts', 'export const valid = 1;\nfunction unfinished( {');

    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'PARSE_ERROR', line: 2 });
    expect(parsed.symbols.some((symbol) => symbol.name === 'valid')).toBe(true);
  });
});
