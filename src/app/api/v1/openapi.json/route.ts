// Phase 9 Part 3 — GET /api/v1/openapi.json
// Public, unauthenticated spec (describes the API; contains no org data), so
// integrators and Swagger UI can discover the surface.
import { NextResponse } from "next/server";
import { buildOpenApiSpec } from "../_lib/openapiSpec";

export async function GET() {
  return NextResponse.json(buildOpenApiSpec(), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
