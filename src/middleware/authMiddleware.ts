import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JwtPayload } from "../config/passport";

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
