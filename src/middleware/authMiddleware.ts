import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JwtPayload } from "../config/passport";
import { prisma } from "../lib/prisma";

declare global {
  namespace Express {
    interface Request {
      currentUser?: JwtPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET!;
const COOKIE_NAME = "av_token";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.currentUser = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Require a signed-in user whose role is ADMIN. The JWT carries no role, so
    the role is read fresh from the DB on each request — a demotion takes effect
    immediately rather than waiting for the 7-day token to expire. */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(payload.id) },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  req.currentUser = payload;
  next();
}

/** Attach req.currentUser when a valid token is present, but never reject —
    used by routes that work for both guests and signed-in users. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      req.currentUser = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
      /* ignore invalid token — treat as guest */
    }
  }
  next();
}
