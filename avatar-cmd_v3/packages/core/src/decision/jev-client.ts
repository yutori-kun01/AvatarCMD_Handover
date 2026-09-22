import { TypeSafeClient } from "@typesafe-ai/sdk";

let client: TypeSafeClient | null = null;

export function isJevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export function getJevModel(): string {
  return process.env.JEV_MODEL || "jev-latest";
}

export function getJevClient(): TypeSafeClient | null {
  if (!isJevConfigured()) return null;
  if (!client) client = new TypeSafeClient();
  return client;
}
