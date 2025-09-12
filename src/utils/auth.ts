import * as crypto from "crypto";
import { posterPassword } from "../config/constants";

const { timingSafeEqual } = crypto;

export function verifyPassword(providedPassword: string): boolean {
  const password: Buffer = Buffer.from(providedPassword || "");
  return timingSafeEqual(password, posterPassword);
}
