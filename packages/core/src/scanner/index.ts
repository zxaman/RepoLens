export { walkDirectoryTree } from './directory-walker.js';
export {
  classifyFile,
  detectFileLanguage,
  isConfigurationFileName,
  isPackageManifestName,
} from './file-classifier.js';
export { IgnoreManager, isSensitivePath } from './ignore-manager.js';
export {
  calculateLanguageStatistics,
  detectLanguage,
  getFileExtension,
} from './language-detector.js';
export { hashDiscoveredFiles } from './file-hasher.js';
export { detectTechnologies } from './technology-detector.js';
export { ScanCancelledError, ScanFileSystemError, ScanRootError } from './scan.errors.js';
export { scanProject } from './scanner.service.js';
export type { ScanProjectOptions } from './scanner.service.js';
export type {
  ClassifiedFile,
  DirectoryWalkResult,
  ScanCancellation,
  ScanFileInfo,
  ScanFileSystem,
  ScanHashResult,
  ScanRequest,
  WalkedFile,
} from './scan.types.js';
