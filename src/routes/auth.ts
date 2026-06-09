import { Router, Request, Response } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { JwtPayload } from "../config/passport";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET!;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";
const COOKIE_NAME = "av_token";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.get(
  "/google",
  passport.authenticate("google", { session: false, scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${FRONTEND_URL}/login?error=oauth_failed`,
  }),
  (req: Request, res: Response) => {
    const user = req.user as { id: number; email: string | null; name: string | null };

    const payload: JwtPayload = {
      id: String(user.id),
      email: user.email ?? "",
      name: user.name ?? "",
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    res.redirect(`${FRONTEND_URL}/`);
  }
);

router.get("/me", (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    res.json({ user: payload });
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });
  res.json({ success: true });
});

export default router;
