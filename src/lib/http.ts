import { Request, Response, NextFunction, RequestHandler } from "express";

/** Wrap an async route handler so thrown errors become a 500 JSON response
    instead of an unhandled rejection. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  };
}

/** Basic RFC-ish email check, matching the frontend's lightweight validation. */
export const isEmail = (s: unknown): s is string =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
