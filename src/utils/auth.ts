import * as crypto from "crypto";
import { posterPassword } from "../config/constants";

const { createHash, timingSafeEqual } = crypto;

// Hash both sides so the buffers are always the same length: timingSafeEqual throws on a length
// mismatch
const digest = (value: Buffer): Buffer => createHash("sha256").update(value).digest();
const expected: Buffer = digest(posterPassword);

export function verifyPassword(providedPassword: string): boolean {
  if (typeof providedPassword !== "string") return false;
  return timingSafeEqual(digest(Buffer.from(providedPassword)), expected);
}
