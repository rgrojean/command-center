import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "sm_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function appPassword(): string {
  return process.env.APP_PASSWORD?.trim() || "rcgcursordemo";
}

function token(): string {
  return createHmac("sha256", appPassword()).update("spec-migrator-5000").digest("hex");
}

function cookieValue(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function isAuthed(req: Request): boolean {
  const got = cookieValue(req);
  if (!got) return false;
  const expect = token();
  const a = Buffer.from(got);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/api/login" && req.method === "POST") return next();
  if (req.path === "/api/health") return next();
  if (req.path === "/api/session" && req.method === "GET") return next();
  if (!req.path.startsWith("/api/")) return next();
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "password required" });
}

function equalPassword(got: string, expect: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(expect);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function loginHandler(req: Request, res: Response): void {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!equalPassword(password, appPassword())) {
    res.status(401).json({ error: "wrong password" });
    return;
  }
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token())}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure ? "; Secure" : ""}`,
  );
  res.json({ ok: true });
}

export function sessionHandler(req: Request, res: Response): void {
  if (!isAuthed(req)) {
    res.status(401).json({ ok: false });
    return;
  }
  res.json({ ok: true });
}
