// The customization document as the server answers it, read with the same validation the server applies to a file.
import { type Customization, readCustomization } from '@ai-office/shared';
import { t } from '../i18n';
import { isRecord } from './parse';

export function parseCustomizationResponse(body: unknown): Customization {
  const read = isRecord(body) ? readCustomization(body.customization, false) : undefined;
  if (read === undefined || !read.ok) throw new Error(t('error.invalidResponse'));
  return read.value;
}
