import fs from "fs";
import path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface FrameworkJsonControl {
  id: string;
  title: string;
  description: string;
  guidance?: string;
}

interface FrameworkJsonDomain {
  name: string;
  controls: FrameworkJsonControl[];
}

interface FrameworkJsonData {
  frameworkName: string;
  version: string;
  description: string;
  domains: FrameworkJsonDomain[];
}

// ------------------------------------------------------------------
// Runtime JSON loader
// ------------------------------------------------------------------

function loadFrameworkJson(fileName: string): FrameworkJsonData {
  const filePath = path.join(process.cwd(), "data", "frameworks", fileName);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as FrameworkJsonData;
}

// Lazy-loaded map: populated on first access
let _predefinedCache: Record<string, FrameworkJsonData> | null = null;

function getPredefinedFrameworks(): Record<string, FrameworkJsonData> {
  if (!_predefinedCache) {
    try {
      _predefinedCache = {
        "DPDP Act 2023": loadFrameworkJson("dpdp-act-2023.json"),
        "ISO 27001:2022": loadFrameworkJson("iso-27001-2022.json"),
        "SOC 2 Type II": loadFrameworkJson("soc2-type2.json"),
      };
    } catch {
      // During build or in environments where the data dir isn't present, return empty
      _predefinedCache = {};
    }
  }

  return _predefinedCache;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function computeProgress(total: number, compliant: number): number {
  if (total === 0) return 0;
  return Math.round((compliant / total) * 100 * 10) / 10; // 1 decimal
}

// ------------------------------------------------------------------
// Router
// ------------------------------------------------------------------

export const frameworkRouter = createTRPCRouter({
  /**
   * List all frameworks for the current organization, with progress metrics.
   */
  list: orgProcedure.query(async ({ ctx }) => {
    const frameworks = await ctx.prisma.framework.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      include: {
        controls: {
          select: { id: true, status: true },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    return frameworks.map((fw) => {
      const total = fw.controls.length;
      const compliant = fw.controls.filter((c) => c.status === "COMPLIANT").length;
      const inProgress = fw.controls.filter((c) => c.status === "IN_PROGRESS").length;
      const notApplicable = fw.controls.filter((c) => c.status === "NOT_APPLICABLE").length;

      return {
        id: fw.id,
        name: fw.name,
        version: fw.version,
        description: fw.description ?? undefined,
        progressPercentage: computeProgress(total, compliant),
        controlCount: total,
        compliantCount: compliant,
        inProgressCount: inProgress,
        notApplicableCount: notApplicable,
        createdAt: fw.createdAt,
        updatedAt: fw.updatedAt,
      };
    });
  }),

  /**
   * Get a single framework by ID, with control details and domain breakdown.
   */
  getById: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const framework = await ctx.prisma.framework.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
        },
        include: {
          controls: {
            include: {
              _count: { select: { evidence: true } },
            },
            orderBy: [{ domain: "asc" }, { title: "asc" }],
          },
        },
      });

      if (!framework) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Framework not found for the current organization.",
        });
      }

      // Build domain breakdown
      const domainMap = new Map<
        string,
        { total: number; compliant: number }
      >();

      for (const control of framework.controls) {
        const existing = domainMap.get(control.domain) ?? {
          total: 0,
          compliant: 0,
        };
        existing.total += 1;
        if (control.status === "COMPLIANT") {
          existing.compliant += 1;
        }
        domainMap.set(control.domain, existing);
      }

      const domainBreakdown = Array.from(domainMap.entries())
        .map(([domain, { total, compliant }]) => ({
          domain,
          total,
          compliant,
          percentage: computeProgress(total, compliant),
        }))
        .sort((a, b) => a.domain.localeCompare(b.domain));

      const total = framework.controls.length;
      const compliant = framework.controls.filter(
        (c) => c.status === "COMPLIANT",
      ).length;

      return {
        id: framework.id,
        name: framework.name,
        version: framework.version,
        description: framework.description ?? undefined,
        createdAt: framework.createdAt,
        updatedAt: framework.updatedAt,
        controls: framework.controls.map((c) => ({
          id: c.id,
          domain: c.domain,
          title: c.title,
          description: c.description,
          status: c.status,
          guidance: c.guidance ?? undefined,
          evidenceCount: c._count.evidence,
        })),
        domainBreakdown,
        progressPercentage: computeProgress(total, compliant),
        controlCount: total,
        compliantCount: compliant,
      };
    }),

  /**
   * Create a new framework for the organization.
   * If the name matches a predefined framework, seed its controls automatically.
   */
  create: managerProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        version: z.string().min(1).max(40).optional().default("1.0"),
        description: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate
      const existing = await ctx.prisma.framework.findUnique({
        where: {
          organizationId_name: {
            organizationId: ctx.session.user.organizationId,
            name: input.name,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Framework "${input.name}" already exists for this organization.`,
        });
      }

      const predefined = getPredefinedFrameworks()[input.name];
      const resolvedDescription =
        input.description ?? predefined?.description ?? undefined;

      const framework = await ctx.prisma.framework.create({
        data: {
          name: input.name,
          version: input.version,
          description: resolvedDescription,
          organizationId: ctx.session.user.organizationId,
        },
      });

      // Auto-seed controls for predefined frameworks
      let controls: Awaited<
        ReturnType<typeof ctx.prisma.control.findMany>
      > = [];

      if (predefined) {
        const controlCreateData = predefined.domains.flatMap((domain) =>
          domain.controls.map((c) => ({
            id: c.id,
            frameworkId: framework.id,
            domain: domain.name,
            title: c.title,
            description: c.description,
            guidance: c.guidance ?? null,
            status: "NOT_STARTED" as const,
          })),
        );

        await ctx.prisma.control.createMany({
          data: controlCreateData,
          skipDuplicates: true,
        });

        controls = await ctx.prisma.control.findMany({
          where: { frameworkId: framework.id },
          orderBy: [{ domain: "asc" }, { title: "asc" }],
        });
      }

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "FRAMEWORK_CREATED",
        entity: "Framework",
        entityId: framework.id,
        changes: {
          name: framework.name,
          version: framework.version,
          controlsSeeded: controls.length,
        },
      });

      return { ...framework, controls };
    }),

  /**
   * Update framework metadata (name, description, version).
   */
  update: managerProcedure
    .input(
      z.object({
        id: z.string().min(1),
        version: z.string().min(1).max(40).optional(),
        description: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.framework.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Framework not found for the current organization.",
        });
      }

      const updated = await ctx.prisma.framework.update({
        where: { id: input.id },
        data: {
          ...(input.version !== undefined && { version: input.version }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "FRAMEWORK_UPDATED",
        entity: "Framework",
        entityId: updated.id,
        changes: { version: input.version, description: input.description },
      });

      return updated;
    }),
});
