export * from './palettes';
export * from './types';
export { applyCustomizationPatch } from './patch';
export * from './resolve';
export * from './apply';
export {
  checkAlias,
  checkLabel,
  checkName,
  isPlainObject,
  isValidKey,
  jsonBytes,
  parseLook,
  parseTheme,
  pruneCustomization,
  readCustomization,
  readStoredCustomization,
  type LabelCheck,
  type ReadResult,
  type StoredOutcome,
} from './validate';
