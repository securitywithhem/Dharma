import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        ok: true,
        timestamp: new Date().toISOString()
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown health check failure"
      },
      { status: 503 },
    );
  }
}
