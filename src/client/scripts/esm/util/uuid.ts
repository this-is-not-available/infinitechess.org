
/**
 * This script generates unique identifiers for us.
 * 
 * ZERO dependancies.
 */

const BASE_36_CHARSET: string = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE_62_CHARSET: string = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generates a random ID of the provided length, with the characters 0-9, a-z, and A-Z.
 */
function generateID_Base62(length: number): string {
	return generateIDWithCharset(length, BASE_62_CHARSET);
}

/**
 * Generates a random ID of the provided length, with the characters 0-9, a-z.
 */
function generateID_Base36(length: number): string {
	return generateIDWithCharset(length, BASE_36_CHARSET);
}

/**
 * Generates a random ID of the provided length using the specified character set.
 * @param length - The length of the desired ID
 * @param characters - The character set to use for generating the ID
 */
function generateIDWithCharset(length: number, characters: string): string {
	let result = '';
	const charactersLength = characters.length;
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}

/**
 * Generates a **UNIQUE** ID of the provided length, with the characters 0-9 and a-z.
 * The provided object should contain the keys of the existing IDs.
 * @param length - The length of the desired ID
 * @param object - The object that contains keys of the existing IDs.
 */
function genUniqueID(length: number, object: Record<string, any>): string {
	let id: string;
	do {
		id = generateID_Base62(length);
	} while (object[id] !== undefined);
	return id;
}

/**
 * Generates a random numeric ID of the provided length, with the numbers 0-9.
 */
function generateNumbID(length: number): number {
	const zeroOne = Math.random();
	const multiplier = 10 ** length;
	return Math.floor(zeroOne * multiplier);
}

/**
 * Converts a number from base 10 to base 62.
 * MUST BE POSITIVE!!!	0+
 */
function base10ToBase62(num: number): string {
	if (!Number.isInteger(num) || num < 0) throw new Error('Input must be a non-negative integer when converting base 10 to base 62. Received: ' + num);

	const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
	let result = '';

	// Handle zero as a special case
	if (num === 0) return '0';

	while (num > 0) {
		const remainder = num % 62;
		result = characters[remainder] + result;
		num = Math.floor(num / 62);
	}

	return result;
}

/**
 * Converts a number from base 62 to base 10.
 * MUST BE VALID BASE 62!!!
 */
function base62ToBase10(base62Str: string): number {
	if (typeof base62Str !== 'string' || base62Str.length === 0) throw new Error('Input must be a non-empty string when converting base 62 to base 10.');

	const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
	const base = 62;

	let result = 0;
	for (let i = 0; i < base62Str.length; i++) {
		const char = base62Str[i]!;
		const value = characters.indexOf(char);

		if (value === -1) {
			throw new Error(`Invalid character '${char}' in base 62 string.`);
		}

		result = result * base + value;
	}

	return result;
}

export default {
	generateID_Base62,
	generateID_Base36,
	genUniqueID,
	generateNumbID,
	base10ToBase62,
	base62ToBase10,
};