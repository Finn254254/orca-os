import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const nano = customAlphabet(alphabet, 12);

export function generateId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

export function now(): string {
  return new Date().toISOString();
}
