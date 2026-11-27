import { describe, expect, it } from 'vitest';
import {
  canonicalPathKey,
  isSameOrDescendantPath,
  normalizeAbsolutePath,
} from './project-path-utils.js';

describe('project path normalization', () => {
  it('removes trailing separators and folds case for Windows duplicate keys', () => {
    expect(normalizeAbsolutePath('C:\\Users\\Dev\\Repo\\', 'win32')).toBe('C:\\Users\\Dev\\Repo');
    expect(canonicalPathKey('C:\\Users\\Dev\\Repo\\', 'win32')).toBe('c:\\users\\dev\\repo');
    expect(canonicalPathKey('c:\\users\\dev\\repo', 'win32')).toBe('c:\\users\\dev\\repo');
  });

  it('checks path containment without treating a similarly named sibling as a child', () => {
    expect(isSameOrDescendantPath('C:\\Work\\Repo\\src', 'c:\\work\\repo', 'win32')).toBe(true);
    expect(isSameOrDescendantPath('C:\\Work\\Repo', 'c:\\work\\repo\\', 'win32')).toBe(true);
    expect(isSameOrDescendantPath('C:\\Work\\Repository', 'C:\\Work\\Repo', 'win32')).toBe(false);
  });
});
