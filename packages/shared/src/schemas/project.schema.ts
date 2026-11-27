import { z } from 'zod';

export const projectIndicatorSchema = z.enum([
  '.git',
  'package.json',
  'angular.json',
  'tsconfig.json',
  'vite.config.ts',
  'next.config.js',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
]);

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (name) => !hasInvalidProjectNameCharacters(name),
    'Project name contains invalid characters.',
  );

function hasInvalidProjectNameCharacters(name: string): boolean {
  return [...name].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === '/' || character === '\\' || codePoint < 0x20 || codePoint === 0x7f;
  });
}

export const projectSchema = z
  .object({
    id: z.uuid(),
    name: projectNameSchema,
    rootPath: z.string().min(1).max(4096),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lastOpenedAt: z.iso.datetime().optional(),
    status: z.enum(['registered', 'unavailable']),
    repositoryType: z.enum(['git', 'local']),
    repositoryIndicators: z.array(projectIndicatorSchema).default([]),
  })
  .strict();

export type ProjectIndicator = z.infer<typeof projectIndicatorSchema>;
export type Project = z.infer<typeof projectSchema>;
