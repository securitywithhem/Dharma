import type { Role } from "@prisma/client";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import nodemailer from "nodemailer";
import { env } from "@/env";
import { prisma } from "@/server/db";

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

function buildMagicLinkHtml(url: string, host: string) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1c1917;">
      <h1 style="font-size: 20px;">Sign in to Dharma</h1>
      <p>Use the secure link below to access your compliance workspace.</p>
      <p>
        <a
          href="${url}"
          style="display: inline-block; padding: 12px 18px; border-radius: 10px; background: #d97706; color: #fffaf0; text-decoration: none; font-weight: 700;"
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

        console.info(`[auth] Magic link for ${identifier}: ${url}`);
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
    maxAge: 30 * 24 * 60 * 60
  },
  callbacks: {
    async signIn() {
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
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = getRoleFromToken(token.role);
        session.user.organizationId =
          typeof token.organizationId === "string" ? token.organizationId : "";
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
