const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const INTEGER_ZERO = 'a0';
const SMALLEST_INTEGER = 'A' + '0'.repeat(26);

/**
 * Returns a fraction digit string strictly between a and b (b null means "1"); neither may end in "0".
 * @since REQ-004
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`Invalid fraction range: ${a} >= ${b}`);
  if (a.endsWith('0') || b?.endsWith('0')) throw new Error('Fraction has a trailing zero');

  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/**
 * Returns the length of the integer part encoded by the head character of a key.
 * @since REQ-004
 */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`Invalid order key head: ${head}`);
}

/**
 * Returns the integer part of a key.
 * @since REQ-004
 */
function integerPart(key: string): string {
  const length = integerLength(key[0] ?? '');
  if (length > key.length) throw new Error(`Invalid order key: ${key}`);
  return key.slice(0, length);
}

/**
 * Throws when a string is not a valid order key.
 * @since REQ-004
 */
function validateKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`Invalid order key: ${key}`);
  const fraction = key.slice(integerPart(key).length);
  if (fraction.endsWith('0')) throw new Error(`Invalid order key: ${key}`);
}

/**
 * Returns the next integer part, or null when it would overflow.
 * @since REQ-004
 */
function incrementInteger(value: string): string | null {
  const [head, ...digits] = value.split('') as [string, ...string[]];
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i]!) + 1;
    if (next === DIGITS.length) {
      digits[i] = '0';
    } else {
      digits[i] = DIGITS[next]!;
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push('0');
  else digits.pop();
  return nextHead + digits.join('');
}

/**
 * Returns the previous integer part, or null when it would underflow.
 * @since REQ-004
 */
function decrementInteger(value: string): string | null {
  const [head, ...digits] = value.split('') as [string, ...string[]];
  const maxDigit = DIGITS[DIGITS.length - 1]!;
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const previous = DIGITS.indexOf(digits[i]!) - 1;
    if (previous === -1) {
      digits[i] = maxDigit;
    } else {
      digits[i] = DIGITS[previous]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return 'Z' + maxDigit;
  if (head === 'A') return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < 'Z') digits.push(maxDigit);
  else digits.pop();
  return previousHead + digits.join('');
}

/**
 * Returns an order key that sorts strictly between a and b by byte order (null means open end),
 * so an item can be placed between two neighbours by writing a single row.
 * @since REQ-004
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a);
  if (b !== null) validateKey(b);
  if (a !== null && b !== null && a >= b) throw new Error(`Invalid key range: ${a} >= ${b}`);

  if (a === null) {
    if (b === null) return INTEGER_ZERO;
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_INTEGER) return intB + midpoint('', fracB);
    if (intB < b) return intB;
    const previous = decrementInteger(intB);
    if (previous === null) throw new Error('Cannot decrement any more');
    return previous;
  }

  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  if (b === null) {
    const next = incrementInteger(intA);
    return next === null ? intA + midpoint(fracA, null) : next;
  }

  const intB = integerPart(b);
  const fracB = b.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const next = incrementInteger(intA);
  if (next === null) throw new Error('Cannot increment any more');
  return next < b ? next : intA + midpoint(fracA, null);
}
