import ts from 'typescript';
import { STATIC_ANALYSIS_LIMITS } from '@repolens/core';
import type {
  ParsedDiagnostic,
  ParsedExport,
  ParsedImport,
  ParsedPathMapping,
  ParsedResolutionConfigResult,
  ParsedSourceFile,
  ParsedSymbol,
  SourceLocation,
  StaticAnalysisParser,
} from '@repolens/core';

const MAX_EXTRACTED_RECORDS_PER_FILE = 25_000;
const MAX_PARSER_DIAGNOSTICS = 250;
const SUPPORTED_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
] as const;

/** TypeScript Compiler API frontend for TypeScript, TSX, JavaScript, and JSX source files. */
export class TypeScriptParser implements StaticAnalysisParser {
  readonly id = 'typescript-compiler-api';
  readonly languageNames = ['TypeScript', 'JavaScript'] as const;
  readonly extensions = SUPPORTED_EXTENSIONS;

  parse(filePath: string, sourceText: string): ParsedSourceFile {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(filePath),
    );
    const symbols: ParsedSymbol[] = [];
    const angularDecoratorAliases = getAngularDecoratorAliases(sourceFile);
    const imports: ParsedImport[] = [];
    const exports: ParsedExport[] = [];
    const syntaxDiagnostics = getSyntaxDiagnostics(sourceFile);
    const moduleKey = 'module';
    const end = locationAt(sourceFile, sourceFile.end);
    symbols.push({
      key: moduleKey,
      name: basename(filePath),
      kind: 'module',
      location: {
        filePath,
        startLine: 1,
        startColumn: 1,
        endLine: end.endLine,
        endColumn: end.endColumn,
      },
      exported: false,
    });

    let nextSymbolKey = 0;
    let nextImportKey = 0;
    let nextExportKey = 0;
    let truncated = false;

    const addSymbol = (
      node: ts.Node,
      name: string,
      kind: ParsedSymbol['kind'],
      parentKey: string,
      exported: boolean,
      semanticRole?: ParsedSymbol['semanticRole'],
    ): string | null => {
      if (symbols.length >= MAX_EXTRACTED_RECORDS_PER_FILE) {
        truncated = true;
        return null;
      }
      const key = `symbol-${nextSymbolKey}`;
      nextSymbolKey += 1;
      symbols.push({
        key,
        name: name.slice(0, 512) || '<anonymous>',
        kind,
        location: locationForNode(filePath, sourceFile, node),
        parentKey,
        ...(semanticRole === undefined ? {} : { semanticRole }),
        exported,
      });
      if (exported) {
        const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
        const localName = name || (isDefault ? 'default' : '<anonymous>');
        addExport(
          isDefault ? 'default' : localName,
          isDefault ? 'default' : 'named',
          localName,
          undefined,
          isTypeOnlyDeclaration(node),
          node,
        );
      }
      return key;
    };

    const addImport = (
      node: ts.Node,
      specifier: string,
      kind: ParsedImport['kind'],
      bindings: ParsedImport['bindings'],
      isTypeOnly: boolean,
    ): void => {
      if (specifier.length === 0 || specifier.length > 4096) {
        truncated = true;
        return;
      }
      if (imports.length >= MAX_EXTRACTED_RECORDS_PER_FILE) {
        truncated = true;
        return;
      }
      const boundedBindings = bindings.slice(0, 1000).map((binding) => {
        if (binding.importedName.length > 512 || binding.localName.length > 512) {
          truncated = true;
        }
        return {
          ...binding,
          importedName: binding.importedName.slice(0, 512) || '<anonymous>',
          localName: binding.localName.slice(0, 512) || '<anonymous>',
        };
      });
      if (bindings.length > boundedBindings.length) {
        truncated = true;
      }
      imports.push({
        key: `import-${nextImportKey}`,
        specifier,
        kind,
        bindings: boundedBindings,
        isTypeOnly,
        location: locationForNode(filePath, sourceFile, node),
      });
      nextImportKey += 1;
    };

    const addExport = (
      name: string,
      kind: ParsedExport['kind'],
      localName: string | undefined,
      source: string | undefined,
      isTypeOnly: boolean,
      node: ts.Node,
    ): void => {
      if (
        name.length === 0 ||
        name.length > 512 ||
        (localName !== undefined && (localName.length === 0 || localName.length > 512)) ||
        (source !== undefined && (source.length === 0 || source.length > 4096))
      ) {
        truncated = true;
        return;
      }
      if (exports.length >= MAX_EXTRACTED_RECORDS_PER_FILE) {
        truncated = true;
        return;
      }
      exports.push({
        key: `export-${nextExportKey}`,
        name,
        kind,
        ...(localName === undefined ? {} : { localName }),
        ...(source === undefined ? {} : { source }),
        isTypeOnly,
        location: locationForNode(filePath, sourceFile, node),
      });
      nextExportKey += 1;
    };

    const visit = (node: ts.Node, parentKey: string): void => {
      if (symbols.length >= MAX_EXTRACTED_RECORDS_PER_FILE) {
        truncated = true;
        return;
      }
      collectModuleRelations(node, addImport, addExport);

      const createdSymbols = createSymbolsForNode(
        node,
        parentKey,
        angularDecoratorAliases,
        addSymbol,
      );
      const newParentKey = createdSymbols.containerKey ?? parentKey;
      ts.forEachChild(node, (child) => visit(child, newParentKey));
    };

    visit(sourceFile, moduleKey);

    return {
      symbols,
      imports,
      exports,
      diagnostics: syntaxDiagnostics.items,
      truncated: truncated || syntaxDiagnostics.truncated,
    };
  }

  parseResolutionConfig(filePath: string, sourceText: string): ParsedResolutionConfigResult {
    const parsed = ts.parseConfigFileTextToJson(filePath, sourceText);
    if (parsed.error !== undefined) {
      return {
        resolution: null,
        diagnostics: [configDiagnostic(parsed.error)],
      };
    }

    const config = asRecord(parsed.config);
    const compilerOptions = asRecord(config?.['compilerOptions']) ?? {};
    const diagnostics: ParsedDiagnostic[] = [];
    let extendsPath: string | undefined;
    const rawExtends = config?.['extends'];
    if (rawExtends !== undefined) {
      if (
        typeof rawExtends === 'string' &&
        rawExtends.length > 0 &&
        rawExtends.length <= STATIC_ANALYSIS_LIMITS.maxTsconfigExtendsPathLength
      ) {
        extendsPath = rawExtends;
      } else {
        diagnostics.push({
          code: 'TSCONFIG_INVALID',
          message:
            'The TypeScript extends option must be one bounded string path; inherited configuration was ignored.',
        });
      }
    }

    let baseUrl: string | undefined;
    const rawBaseUrl = compilerOptions['baseUrl'];
    if (rawBaseUrl !== undefined) {
      if (
        typeof rawBaseUrl === 'string' &&
        rawBaseUrl.length <= STATIC_ANALYSIS_LIMITS.maxTsconfigBaseUrlLength
      ) {
        baseUrl = rawBaseUrl;
      } else {
        diagnostics.push({
          code: 'TSCONFIG_INVALID',
          message:
            'The tsconfig baseUrl option is invalid or exceeds its safe length; it was ignored.',
        });
      }
    }

    let paths: ParsedPathMapping[] | undefined;
    const rawPaths = compilerOptions['paths'];
    if (rawPaths !== undefined) {
      const pathsRecord = asRecord(rawPaths);
      if (pathsRecord === null) {
        diagnostics.push({
          code: 'TSCONFIG_INVALID',
          message: 'The tsconfig paths option is not an object; path aliases were ignored.',
        });
      } else {
        paths = [];
        const pathEntries = Object.entries(pathsRecord);
        for (const [index, [pattern, rawTargets]] of pathEntries.entries()) {
          if (index >= STATIC_ANALYSIS_LIMITS.maxTsconfigPathMappings) {
            diagnostics.push({
              code: 'RESULT_LIMIT_REACHED',
              message: `Only the first ${STATIC_ANALYSIS_LIMITS.maxTsconfigPathMappings} TypeScript path mappings in a configuration were considered.`,
            });
            break;
          }
          if (
            pattern.length === 0 ||
            pattern.length > 512 ||
            (pattern.match(/\*/g)?.length ?? 0) > 1 ||
            !Array.isArray(rawTargets) ||
            rawTargets.length === 0 ||
            rawTargets.length > 100
          ) {
            diagnostics.push({
              code: 'TSCONFIG_INVALID',
              message: `The tsconfig path mapping for ${pattern.slice(0, 100)} is invalid and was ignored.`,
            });
            continue;
          }
          const targets = rawTargets.filter(
            (target): target is string =>
              typeof target === 'string' && target.length > 0 && target.length <= 1024,
          );
          if (targets.length !== rawTargets.length) {
            diagnostics.push({
              code: 'TSCONFIG_INVALID',
              message: `One or more targets for the tsconfig path mapping ${pattern.slice(0, 100)} were invalid.`,
            });
          }
          if (targets.length > 0) {
            paths.push({ pattern, targets });
          }
        }
      }
    }

    return {
      resolution: {
        ...(extendsPath === undefined ? {} : { extends: extendsPath }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(paths === undefined ? {} : { paths }),
      },
      diagnostics,
    };
  }
}

interface AngularDecoratorAliases {
  readonly rolesByLocalName: ReadonlyMap<string, 'component' | 'service'>;
  readonly namespaceImports: ReadonlySet<string>;
}

function getAngularDecoratorAliases(sourceFile: ts.SourceFile): AngularDecoratorAliases {
  const rolesByLocalName = new Map<string, 'component' | 'service'>();
  const namespaceImports = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@angular/core'
    ) {
      continue;
    }
    const importClause = statement.importClause;
    const bindings = importClause?.namedBindings;
    if (importClause === undefined || importClause.isTypeOnly || bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      namespaceImports.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'Component' || importedName === 'Injectable') {
        rolesByLocalName.set(
          element.name.text,
          importedName === 'Component' ? 'component' : 'service',
        );
      }
    }
  }
  return { rolesByLocalName, namespaceImports };
}

function getClassSemanticRole(
  node: ts.ClassDeclaration | ts.ClassExpression,
  aliases: AngularDecoratorAliases,
): 'component' | 'service' | undefined {
  const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
  for (const decorator of decorators) {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    if (ts.isIdentifier(expression)) {
      const role = aliases.rolesByLocalName.get(expression.text);
      if (role !== undefined) {
        return role;
      }
    } else if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      aliases.namespaceImports.has(expression.expression.text)
    ) {
      const role =
        expression.name.text === 'Component'
          ? 'component'
          : expression.name.text === 'Injectable'
            ? 'service'
            : undefined;
      if (role !== undefined) {
        return role;
      }
    }
  }
  return undefined;
}

function createSymbolsForNode(
  node: ts.Node,
  parentKey: string,
  angularDecoratorAliases: AngularDecoratorAliases,
  addSymbol: (
    node: ts.Node,
    name: string,
    kind: ParsedSymbol['kind'],
    parentKey: string,
    exported: boolean,
    semanticRole?: ParsedSymbol['semanticRole'],
  ) => string | null,
): { readonly containerKey?: string } {
  if (ts.isVariableDeclaration(node)) {
    if (
      node.initializer !== undefined &&
      (ts.isFunctionExpression(node.initializer) ||
        ts.isArrowFunction(node.initializer) ||
        ts.isClassExpression(node.initializer))
    ) {
      return {};
    }
    for (const identifier of bindingIdentifiers(node.name)) {
      addSymbol(identifier, identifier.text, 'variable', parentKey, isVariableExported(node));
    }
    return {};
  }

  if (ts.isParameter(node)) {
    for (const identifier of bindingIdentifiers(node.name)) {
      addSymbol(identifier, identifier.text, 'parameter', parentKey, false);
    }
    return {};
  }

  if (ts.isEnumMember(node)) {
    const name = declarationName(node.name);
    if (name !== null) {
      addSymbol(node, name, 'enum-member', parentKey, false);
    }
    return {};
  }

  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    const name = node.name === undefined ? null : declarationName(node.name);
    if (name !== null) {
      addSymbol(node, name, 'property', parentKey, false);
    }
    return {};
  }

  if (ts.isConstructorDeclaration(node)) {
    const key = addSymbol(node, 'constructor', 'constructor', parentKey, false);
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const name = node.name === undefined ? null : declarationName(node.name);
    if (name === null) {
      return {};
    }
    const key = addSymbol(node, name, 'method', parentKey, false);
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
    const name = node.name === undefined ? null : declarationName(node.name);
    if (name === null) {
      return {};
    }
    const key = addSymbol(node, name, 'accessor', parentKey, false);
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isFunctionDeclaration(node)) {
    const name =
      node.name?.text ??
      (hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : '<anonymous>');
    const key = addSymbol(
      node,
      name,
      'function',
      parentKey,
      hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword),
    );
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const ownName = ts.isFunctionExpression(node) ? node.name?.text : undefined;
    const name = ownName ?? inferredFunctionName(node) ?? '<anonymous>';
    const exported = ts.isVariableDeclaration(node.parent) && isVariableExported(node.parent);
    const key = addSymbol(node, name, 'function', parentKey, exported);
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const assignedName = ts.isClassExpression(node) ? inferredAssignedName(node) : null;
    const name = node.name?.text ?? assignedName ?? '<anonymous>';
    const exported = ts.isClassDeclaration(node)
      ? hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword)
      : ts.isVariableDeclaration(node.parent) && isVariableExported(node.parent);
    const key = addSymbol(
      node,
      name,
      'class',
      parentKey,
      exported,
      getClassSemanticRole(node, angularDecoratorAliases),
    );
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isInterfaceDeclaration(node)) {
    const key = addSymbol(
      node,
      node.name.text,
      'interface',
      parentKey,
      hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword),
    );
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isTypeAliasDeclaration(node)) {
    addSymbol(
      node,
      node.name.text,
      'type',
      parentKey,
      hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword),
    );
    return {};
  }

  if (ts.isEnumDeclaration(node)) {
    const key = addSymbol(
      node,
      node.name.text,
      'enum',
      parentKey,
      hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword),
    );
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isModuleDeclaration(node)) {
    const name = declarationName(node.name);
    if (name === null) {
      return {};
    }
    const key = addSymbol(
      node,
      name,
      'namespace',
      parentKey,
      hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword),
    );
    return key === null ? {} : { containerKey: key };
  }

  if (ts.isImportEqualsDeclaration(node)) {
    addSymbol(
      node,
      node.name.text,
      'variable',
      parentKey,
      hasModifier(node, ts.SyntaxKind.ExportKeyword),
    );
  }

  return {};
}

function collectModuleRelations(
  node: ts.Node,
  addImport: (
    node: ts.Node,
    specifier: string,
    kind: ParsedImport['kind'],
    bindings: ParsedImport['bindings'],
    isTypeOnly: boolean,
  ) => void,
  addExport: (
    name: string,
    kind: ParsedExport['kind'],
    localName: string | undefined,
    source: string | undefined,
    isTypeOnly: boolean,
    node: ts.Node,
  ) => void,
): void {
  if (ts.isImportDeclaration(node)) {
    const specifier = staticString(node.moduleSpecifier);
    if (specifier === null) {
      return;
    }
    const clause = node.importClause;
    const bindings: ParsedImport['bindings'][number][] = [];
    if (clause?.name !== undefined) {
      bindings.push({
        importedName: 'default',
        localName: clause.name.text,
        kind: 'default',
        isTypeOnly: clause.isTypeOnly,
      });
    }
    if (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push({
        importedName: '*',
        localName: clause.namedBindings.name.text,
        kind: 'namespace',
        isTypeOnly: clause.isTypeOnly,
      });
    } else if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        bindings.push({
          importedName: (element.propertyName ?? element.name).text,
          localName: element.name.text,
          kind: 'named',
          isTypeOnly: clause.isTypeOnly || element.isTypeOnly,
        });
      }
    }
    const allTypeOnly =
      clause?.isTypeOnly === true ||
      (bindings.length > 0 && bindings.every((binding) => binding.isTypeOnly));
    addImport(node, specifier, allTypeOnly ? 'type-only' : 'static', bindings, allTypeOnly);
    return;
  }

  if (ts.isExportDeclaration(node)) {
    const specifier =
      node.moduleSpecifier === undefined ? null : staticString(node.moduleSpecifier);
    if (node.exportClause === undefined) {
      if (specifier !== null) {
        addImport(node, specifier, 're-export', [], node.isTypeOnly);
        addExport('*', 'star', undefined, specifier, node.isTypeOnly, node);
      }
      return;
    }
    if (ts.isNamespaceExport(node.exportClause)) {
      const name = node.exportClause.name.text;
      if (specifier !== null) {
        addImport(node, specifier, 're-export', [], node.isTypeOnly);
      }
      addExport(name, 'namespace', undefined, specifier ?? undefined, node.isTypeOnly, node);
      return;
    }
    if (ts.isNamedExports(node.exportClause)) {
      if (specifier !== null) {
        addImport(node, specifier, 're-export', [], node.isTypeOnly);
      }
      for (const element of node.exportClause.elements) {
        const name = element.name.text;
        const localName =
          specifier === null ? (element.propertyName ?? element.name).text : undefined;
        const isTypeOnly = node.isTypeOnly || element.isTypeOnly;
        addExport(
          name,
          name === 'default' ? 'default' : 'named',
          localName,
          specifier ?? undefined,
          isTypeOnly,
          element,
        );
      }
    }
    return;
  }

  if (ts.isExportAssignment(node)) {
    const isExportEquals = node.isExportEquals;
    addExport(
      isExportEquals ? 'export=' : 'default',
      isExportEquals ? 'assignment' : 'default',
      undefined,
      undefined,
      false,
      node,
    );
    return;
  }

  if (ts.isNamespaceExportDeclaration(node)) {
    addExport(node.name.text, 'namespace', undefined, undefined, false, node);
    return;
  }

  if (ts.isImportEqualsDeclaration(node)) {
    if (
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined
    ) {
      const specifier = staticString(node.moduleReference.expression);
      if (specifier !== null) {
        addImport(
          node,
          specifier,
          'typescript-import-equals',
          [
            {
              importedName: '*',
              localName: node.name.text,
              kind: 'namespace',
              isTypeOnly: node.isTypeOnly,
            },
          ],
          node.isTypeOnly,
        );
      }
    }
    return;
  }

  if (ts.isImportTypeNode(node)) {
    const argument = node.argument;
    if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
      addImport(node, argument.literal.text, 'type-only', [], true);
    }
    return;
  }

  if (ts.isCallExpression(node)) {
    const calledName = node.expression;
    const firstArgument = node.arguments[0];
    const specifier = firstArgument === undefined ? null : staticString(firstArgument);
    if (specifier === null) {
      return;
    }
    if (calledName.kind === ts.SyntaxKind.ImportKeyword) {
      addImport(node, specifier, 'dynamic', [], false);
      return;
    }
    if (ts.isIdentifier(calledName) && calledName.text === 'require') {
      addImport(node, specifier, 'commonjs', [], false);
      return;
    }
    if (
      ts.isPropertyAccessExpression(calledName) &&
      ts.isIdentifier(calledName.expression) &&
      calledName.expression.text === 'require' &&
      calledName.name.text === 'resolve'
    ) {
      addImport(node, specifier, 'commonjs-resolve', [], false);
    }
    return;
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const exportedName = commonJsExportName(node.left);
    if (exportedName !== null) {
      addExport(exportedName, 'commonjs', undefined, undefined, false, node);
    }
  }
}

function commonJsExportName(node: ts.Expression): string | null {
  const expression = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(expression)) {
    if (ts.isIdentifier(expression.expression) && expression.expression.text === 'exports') {
      return expression.name.text;
    }
    if (isModuleExports(expression.expression)) {
      return expression.name.text;
    }
    if (isModuleExports(expression)) {
      return 'default';
    }
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression !== undefined) {
    const name = staticString(expression.argumentExpression);
    if (name !== null) {
      if (ts.isIdentifier(expression.expression) && expression.expression.text === 'exports') {
        return name;
      }
      if (isModuleExports(expression.expression)) {
        return name;
      }
    }
  }
  return null;
}

function isModuleExports(node: ts.Expression): boolean {
  const expression = unwrapExpression(node);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'module' &&
    expression.name.text === 'exports'
  );
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function inferredFunctionName(node: ts.FunctionExpression | ts.ArrowFunction): string | null {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) {
    return bindingIdentifiers(parent.name)[0]?.text ?? null;
  }
  if (ts.isBinaryExpression(parent) && parent.right === node) {
    return commonJsExportName(parent.left);
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return declarationName(parent.name);
  }
  return null;
}

function inferredAssignedName(node: ts.ClassExpression): string | null {
  const parent = node.parent;
  return ts.isVariableDeclaration(parent)
    ? (bindingIdentifiers(parent.name)[0]?.text ?? null)
    : null;
}

function bindingIdentifiers(name: ts.BindingName): ts.Identifier[] {
  const identifiers: ts.Identifier[] = [];
  const visitBindingName = (bindingName: ts.BindingName): void => {
    if (ts.isIdentifier(bindingName)) {
      identifiers.push(bindingName);
      return;
    }
    for (const element of bindingName.elements) {
      if (!ts.isOmittedExpression(element)) {
        visitBindingName(element.name);
      }
    }
  };
  visitBindingName(name);
  return identifiers;
}

function declarationName(name: ts.PropertyName | ts.ModuleName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return null;
}

function staticString(node: ts.Node): string | null {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function isVariableExported(node: ts.VariableDeclaration): boolean {
  const statement = node.parent.parent;
  return (
    (ts.isVariableStatement(statement) || ts.isVariableDeclarationList(statement)) &&
    (hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}

function isTypeOnlyDeclaration(node: ts.Node): boolean {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

function locationForNode(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): SourceLocation {
  return {
    filePath,
    ...locationAt(sourceFile, node.getStart(sourceFile, false)),
    ...endLocationAt(sourceFile, node.getEnd()),
  };
}

function locationAt(
  sourceFile: ts.SourceFile,
  position: number,
): Pick<SourceLocation, 'startLine' | 'startColumn' | 'endLine' | 'endColumn'> {
  const start = sourceFile.getLineAndCharacterOfPosition(position);
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: start.line + 1,
    endColumn: start.character + 1,
  };
}

function endLocationAt(
  sourceFile: ts.SourceFile,
  position: number,
): Pick<SourceLocation, 'endLine' | 'endColumn'> {
  const end = sourceFile.getLineAndCharacterOfPosition(position);
  return { endLine: end.line + 1, endColumn: end.character + 1 };
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  const extension = extensionOf(filePath);
  if (extension === '.tsx') {
    return ts.ScriptKind.TSX;
  }
  if (extension === '.jsx') {
    return ts.ScriptKind.JSX;
  }
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function extensionOf(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot).toLowerCase();
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

function getSyntaxDiagnostics(sourceFile: ts.SourceFile): {
  readonly items: ParsedDiagnostic[];
  readonly truncated: boolean;
} {
  // TypeScript exposes this array on parsed SourceFiles at runtime; it is omitted from its public d.ts.
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics === undefined) {
    return { items: [], truncated: false };
  }
  const items = parseDiagnostics.slice(0, MAX_PARSER_DIAGNOSTICS).map((diagnostic) => {
    const location =
      diagnostic.start === undefined
        ? undefined
        : sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    return {
      code: 'PARSE_ERROR' as const,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').slice(0, 1_024),
      ...(location === undefined
        ? {}
        : { line: location.line + 1, column: location.character + 1 }),
    };
  });
  return { items, truncated: parseDiagnostics.length > MAX_PARSER_DIAGNOSTICS };
}

function configDiagnostic(diagnostic: ts.Diagnostic): ParsedDiagnostic {
  const location =
    diagnostic.file === undefined || diagnostic.start === undefined
      ? undefined
      : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    code: 'TSCONFIG_INVALID',
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ...(location === undefined ? {} : { line: location.line + 1, column: location.character + 1 }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
