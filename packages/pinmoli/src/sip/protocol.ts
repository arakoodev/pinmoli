/**
 * SIP protocol message building
 */

const SIP_RESERVED_HEADERS = new Set([
  'to', 'from', 'call-id', 'cseq', 'contact', 'via', 'max-forwards',
]);

export function mergeCustomHeaders(
  baseHeaders: Record<string, any>,
  customHeaders: Record<string, string>
): { headers: Record<string, any>; warnings: string[] } {
  const merged = { ...baseHeaders };
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(customHeaders)) {
    if (SIP_RESERVED_HEADERS.has(key.toLowerCase())) {
      warnings.push(`Custom header "${key}" ignored — overwriting transaction-critical SIP headers is not allowed.`);
      continue;
    }
    merged[key] = value;
  }

  return { headers: merged, warnings };
}

export function generateCallId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@pinmoli`;
}

export function generateTag(): string {
  return Math.random().toString(36).substr(2, 9);
}
