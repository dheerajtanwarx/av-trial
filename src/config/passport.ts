import passport from "passport";
import {
  Strategy as GoogleStrategy,
  Profile,
  VerifyCallback,
} from "passport-google-oauth20";
import { prisma } from "../lib/prisma";

export interface JwtPayload {
  id: string;
  email: string;
  name: string;
}

export function configurePassport(): void {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: `${process.env.SERVER_URL}/auth/google/callback`,
        scope: ["profile", "email"],
      },
      async (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback
      ) => {
        try {
          const providerAccountId = profile.id;
          const email = profile.emails?.[0]?.value ?? null;
          const name = profile.displayName ?? null;

          const existingAccount = await prisma.account.findUnique({
            where: {
              provider_providerAccountId: {
                provider: "google",
                providerAccountId,
              },
            },
            include: { user: true },
          });

          if (existingAccount) {
            return done(null, existingAccount.user);
          }

          let user = email
            ? await prisma.user.findUnique({ where: { email } })
            : null;

          if (!user) {
            user = await prisma.user.create({
              data: { email, name },
            });
          }

          await prisma.account.create({
            data: {
              userId: user.id,
              type: "oauth",
              provider: "google",
              providerAccountId,
              access_token: accessToken,
              refresh_token: refreshToken ?? null,
            },
          });

          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );
}
