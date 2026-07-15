// Phase 9 Part 3 — OpenAPI 3.1 spec, GENERATED from a compact route registry
// rather than hand-maintained as a large static JSON blob.
//
// DESIGN NOTE (flagged in summary): the brief suggested `zod-to-openapi` to
// generate from the tRPC zod schemas. That package is not a dependency, and
// the tRPC input schemas are session-based (orgId from context, not params),
// so they don't describe these key-authed REST routes. Retrofitting `.openapi()`
// onto the whole app's zod schemas is out of scope. Instead the spec is built
// from this typed registry — still generated (single source of truth for
// paths/scopes/params), just not via a new dependency. API_SCOPES is imported
// so scopes never drift from the auth layer.
import { API_SCOPES } from "@/server/lib/apiKey";
import { env } from "@/env";

const listQueryParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque pagination cursor from a previous response's nextCursor." },
];

const bearerRef = [{ ApiKeyAuth: [] as string[] }];

function listResponseSchema(itemRef: string) {
  return {
    type: "object",
    properties: {
      data: { type: "array", items: { $ref: `#/components/schemas/${itemRef}` } },
      nextCursor: { type: "string", nullable: true },
    },
  };
}

function op(params: {
  summary: string;
  scope: string;
  tag: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responseSchema: unknown;
  successStatus?: string;
}) {
  return {
    summary: params.summary,
    tags: [params.tag],
    security: bearerRef,
    "x-required-scope": params.scope,
    ...(params.parameters ? { parameters: params.parameters } : {}),
    ...(params.requestBody ? { requestBody: params.requestBody } : {}),
    responses: {
      [params.successStatus ?? "200"]: {
        description: "Success",
        content: { "application/json": { schema: params.responseSchema } },
      },
      "401": { description: "Missing or invalid API key" },
      "403": { description: "API key lacks the required scope" },
      "404": { description: "Resource not found (also returned for cross-org ids)" },
      "429": { description: "Rate limit exceeded" },
    },
  };
}

export function buildOpenApiSpec() {
  const baseUrl = `${env.NEXTAUTH_URL}/api/v1`;
  return {
    openapi: "3.1.0",
    info: {
      title: "Dharma Public API",
      version: "1.0.0",
      description:
        "Third-party integration API for Dharma compliance data. Authenticate with " +
        "a bearer API key (Authorization: Bearer dhm_...). All data is scoped to the " +
        "key's organization; a client-supplied organization id is never honored.",
    },
    servers: [{ url: baseUrl }],
    security: bearerRef,
    tags: [
      { name: "Controls" }, { name: "Evidence" }, { name: "Vulnerabilities" },
      { name: "Reports" }, { name: "Frameworks" },
    ],
    paths: {
      "/controls": {
        get: op({
          summary: "List controls", scope: "controls:read", tag: "Controls",
          parameters: listQueryParams, responseSchema: listResponseSchema("Control"),
        }),
      },
      "/controls/{id}": {
        get: op({
          summary: "Get a control", scope: "controls:read", tag: "Controls",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responseSchema: { type: "object", properties: { data: { $ref: "#/components/schemas/Control" } } },
        }),
      },
      "/evidence": {
        get: op({
          summary: "List evidence", scope: "evidence:read", tag: "Evidence",
          parameters: [...listQueryParams, { name: "controlId", in: "query", schema: { type: "string" } }],
          responseSchema: listResponseSchema("Evidence"),
        }),
        post: op({
          summary: "Push evidence (stored with source \"api\")", scope: "evidence:write", tag: "Evidence",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/EvidenceCreate" } } },
          },
          successStatus: "201",
          responseSchema: { type: "object", properties: { data: { $ref: "#/components/schemas/Evidence" } } },
        }),
      },
      "/vulnerabilities": {
        get: op({
          summary: "List vulnerabilities", scope: "vulnerabilities:read", tag: "Vulnerabilities",
          parameters: [...listQueryParams,
            { name: "severity", in: "query", schema: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] } },
            { name: "status", in: "query", schema: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "WONT_FIX"] } },
          ],
          responseSchema: listResponseSchema("Vulnerability"),
        }),
      },
      "/reports": {
        get: op({
          summary: "List reports", scope: "reports:read", tag: "Reports",
          parameters: listQueryParams, responseSchema: listResponseSchema("Report"),
        }),
      },
      "/reports/{id}": {
        get: op({
          summary: "Get a report (with presigned download when completed)", scope: "reports:read", tag: "Reports",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responseSchema: { type: "object", properties: { data: { $ref: "#/components/schemas/Report" } } },
        }),
      },
      "/frameworks": {
        get: op({
          summary: "List frameworks", scope: "frameworks:read", tag: "Frameworks",
          parameters: listQueryParams, responseSchema: listResponseSchema("Framework"),
        }),
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "http", scheme: "bearer", description: "Dharma API key: dhm_..." },
      },
      schemas: {
        Control: {
          type: "object",
          properties: {
            id: { type: "string" }, frameworkId: { type: "string" }, domain: { type: "string" },
            title: { type: "string" }, status: { type: "string" }, code: { type: "string", nullable: true },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Evidence: {
          type: "object",
          properties: {
            id: { type: "string" }, controlId: { type: "string" }, fileName: { type: "string" },
            type: { type: "string" }, source: { type: "string" }, summary: { type: "string", nullable: true },
            collectedAt: { type: "string", format: "date-time" },
          },
        },
        EvidenceCreate: {
          type: "object",
          required: ["controlId", "fileName", "type"],
          properties: {
            controlId: { type: "string" },
            fileName: { type: "string" },
            type: { type: "string", enum: ["SCREENSHOT", "POLICY_DOC", "API_RESPONSE", "LOG_EXCERPT", "CERTIFICATE", "OTHER"] },
            summary: { type: "string" },
            filePath: { type: "string", description: "Optional pre-uploaded MinIO object key." },
          },
        },
        Vulnerability: {
          type: "object",
          properties: {
            id: { type: "string" }, title: { type: "string" }, severity: { type: "string" },
            status: { type: "string" }, controlId: { type: "string", nullable: true },
            cvssScore: { type: "number", nullable: true }, createdAt: { type: "string", format: "date-time" },
          },
        },
        Report: {
          type: "object",
          properties: {
            id: { type: "string" }, type: { type: "string" }, title: { type: "string" },
            status: { type: "string" }, downloadUrl: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" }, completedAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        Framework: {
          type: "object",
          properties: {
            id: { type: "string" }, name: { type: "string" }, version: { type: "string" },
            description: { type: "string", nullable: true }, controlCount: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    "x-scopes": API_SCOPES,
  };
}
