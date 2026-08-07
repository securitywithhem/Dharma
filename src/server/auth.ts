import type { Role } from "@prisma/client";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import nodemailer from "nodemailer";
import { env } from "@/env";
import { prisma } from "@/server/db";
import {
  SESSION_ISSUED_AT_CLAIM,
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  nowSessionIssuedAt,
} from "@/server/lib/sessionPolicy";

const shouldEnableGoogle =
  env.GOOGLE_CLIENT_ID.length > 0 && env.GOOGLE_CLIENT_SECRET.length > 0;

const shouldEnableEmail =
  env.EMAIL_SERVER_HOST.length > 0 &&
  env.EMAIL_SERVER_USER.length > 0 &&
  env.EMAIL_SERVER_PASSWORD.length > 0;

function deriveOrganizationName(email: string, name?: string | null) {
  const emailDomain = email.split("@")[1] ?? "organization";
  const baseName = name?.trim() || emailDomain.split(".")[0] || "Dharma";
  return `${baseName.replace(/\s+/g, " ").trim()} Workspace`;
}

function createDharmaAdapter(): Adapter {
  const baseAdapter = PrismaAdapter(prisma);

  return {
    ...baseAdapter,
    async createUser(data: AdapterUser) {
      return prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: deriveOrganizationName(data.email, data.name)
          }
        });

        return tx.user.create({
          data: {
            email: data.email,
            name: data.name,
            image: data.image,
            emailVerified: data.emailVerified,
            organizationId: organization.id,
            role: "ADMIN"
          }
        });
      });
    }
  };
}

function getRoleFromToken(value: unknown): Role {
  if (value === "ADMIN" || value === "COMPLIANCE_MANAGER" || value === "VIEWER") {
    return value;
  }

  return "VIEWER";
}

// Inline literal hex, and inline styles rather than classes: mail clients strip
// <style> blocks and do not resolve CSS custom properties, so the tokens in
// globals.css cannot reach here. Values are the light-mode --foreground and
// --primary resolved to hex; keep them in step. The button was #d97706, the
// saffron primary retired with the old UI docs, which meant the first thing a
// new user saw was a colour that appears nowhere in the product.
function buildMagicLinkHtml(url: string, host: string) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #181c2a;">
      <h1 style="font-size: 20px;">Sign in to Dharma</h1>
      <p>Use the secure link below to access your compliance workspace.</p>
      <p>
        <a
          href="${url}"
          style="display: inline-block; padding: 12px 18px; border-radius: 10px; background: #2d3a80; color: #f8f6f1; text-decoration: none; font-weight: 700;"
        >
          Sign in
        </a>
      </p>
      <p>This link was generated for ${host} and expires automatically.</p>
    </div>
  `;
}

export const authOptions: NextAuthOptions = {
  adapter: createDharmaAdapter(),
  providers: [
    ...(shouldEnableGoogle
      ? [
          GoogleProvider({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true
          })
        ]
      : []),
    EmailProvider({
      server: shouldEnableEmail
        ? {
            host: env.EMAIL_SERVER_HOST,
            port: env.EMAIL_SERVER_PORT,
            auth: {
              user: env.EMAIL_SERVER_USER,
              pass: env.EMAIL_SERVER_PASSWORD
            }
          }
        : {
            jsonTransport: true
          },
      from: env.EMAIL_FROM,
      async sendVerificationRequest({ identifier, url, provider, theme }) {
        if (shouldEnableEmail) {
          const transport = nodemailer.createTransport(provider.server);
          const { host } = new URL(url);

          await transport.sendMail({
            to: identifier,
            from: provider.from,
            subject: `Sign in to Dharma (${host})`,
            text: `Sign in to Dharma: ${url}`,
            html: buildMagicLinkHtml(url, host)
          });

          return;
        }

        console.info(`[auth] Magic link generated for ${identifier}: ${url}`);
      }
    })
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
    verifyRequest: "/auth/callback"
  },
  session: {
    strategy: "jwt",
    // GH #22 — both values, and the reasoning for choosing them over 30 days,
    // live in src/server/lib/sessionPolicy.ts so the enterprise-SSO minting
    // path (which encodes its own JWT outside this flow) cannot drift from it.
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS
  },
  callbacks: {
    // Phase 8 Part 1: block deactivated (SCIM-deprovisioned) users, and
    // block password/Google sign-in for orgs that enforce SSO-only login.
    // Enterprise SSO logins don't pass through here (they mint the session
    // in src/server/services/sso/session.ts), so this check only ever
    // constrains the non-SSO paths — exactly what "SSO-only" means.
    async signIn({ user }) {
      const email = user?.email;
      if (!email) {
        return true;
      }

      const existing = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          isActive: true,
          organization: {
            select: { settings: { select: { ssoEnforced: true } } },
          },
        },
      });

      if (!existing) {
        // Brand-new signup — creates its own org, nothing to enforce yet.
        return true;
      }
      if (!existing.isActive) {
        return false;
      }
      if (existing.organization.settings?.ssoEnforced) {
        return false;
      }

      return true;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }

      if (new URL(url).origin === baseUrl) {
        return url;
      }

      return `${baseUrl}/dashboard`;
    },
    async jwt({ token, user }) {
      if (user) {
        const dbUser = user as {
          id: string;
          role: Role;
          organizationId: string;
        };
        token.sub = dbUser.id;
        token.role = dbUser.role;
        token.organizationId = dbUser.organizationId;
        // GH #22 — stamp the session's true origin, once. `user` is only
        // present at sign-in, so every later re-encode (hourly, per
        // SESSION_UPDATE_AGE_SECONDS) carries this value forward untouched.
        // That is the whole point: the standard `iat` claim IS rewritten on
        // each re-encode, so a revocation cutoff compared against it would be
        // defeated by an attacker simply keeping the stolen session active.
        token[SESSION_ISSUED_AT_CLAIM] = nowSessionIssuedAt();
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = getRoleFromToken(token.role);
        session.user.organizationId =
          typeof token.organizationId === "string" ? token.organizationId : "";
        // Carried onto the session so the tRPC layer can compare it against the
        // user's revocation cutoff. Left undefined for tokens minted before
        // #22 shipped — sessionPolicy.isSessionWithinValidity fails those
        // closed once a cutoff exists, which is the intended behaviour.
        const issuedAt = token[SESSION_ISSUED_AT_CLAIM];
        session.user.sessionIssuedAt =
          typeof issuedAt === "number" ? issuedAt : undefined;
      }

      return session;
    }
  },
  secret: env.NEXTAUTH_SECRET
};

export const authCapabilities = {
  google: shouldEnableGoogle,
  email: true
};
