/**
 * Safe JSON stringify that handles circular references and BigInt.
 */

export function safeStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'bigint') {
          return val.toString();
        }
        return val;
      },
      space
    );
  } catch {
    return String(value);
  }
}
