import { randomUUID } from "node:crypto";
import type { IdGenerator } from "../ports.js";

export function createIdGenerator(): IdGenerator {
  return {
    newId(): string {
      return randomUUID();
    },
  };
}
