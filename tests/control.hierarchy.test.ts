import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";

// Import only the control router — importing the full appRouter would pull in
// unrelated BullMQ queues that open real Redis connections at module load.
// eslint-disable-next-line import/first
import { controlRouter } from "@/server/routers/control";

const testRouter = createTRPCRouter({ control: controlRouter });
const prisma = new PrismaClient();

function createCaller(orgId: string, uid: string, role: Role = Role.ADMIN) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: uid, email: "t@example.com", name: "T", organizationId: orgId, role },
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

async function seedOrg(label: string) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${stamp}@test.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  const framework = await prisma.framework.create({
    data: { name: `${label} Framework ${stamp}`, organizationId: org.id },
  });
  // Root control, seeded the way the app does (with a materialized path incl. self).
  const root = await prisma.control.create({
    data: { frameworkId: framework.id, title: `${label} Root`, domain: "Access Control", description: "root" },
  });
  await prisma.control.update({ where: { id: root.id }, data: { path: [root.id] } });
  return { org, user, framework, root };
}

/** Read raw hierarchy fields straight from the DB for assertions. */
async function raw(id: string) {
  const c = await prisma.control.findUniqueOrThrow({
    where: { id },
    select: { parentId: true, depth: true, path: true },
  });
  return { parentId: c.parentId, depth: c.depth, path: c.path as string[] };
}

describe("control hierarchy router", () => {
  let orgA: Awaited<ReturnType<typeof seedOrg>>;
  let orgB: Awaited<ReturnType<typeof seedOrg>>;

  beforeAll(async () => {
    orgA = await seedOrg("OrgA");
    orgB = await seedOrg("OrgB");
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgA.org.id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: orgB.org.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("createChild computes path/depth and inherits parent domain", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id);
    const child = await caller.control.createChild({
      frameworkId: orgA.framework.id,
      parentId: orgA.root.id,
      title: "Child",
      description: "child desc",
      code: "AC-2",
    });

    expect(child.depth).toBe(1);
    expect(child.parentId).toBe(orgA.root.id);
    expect(child.domain).toBe("Access Control"); // inherited
    expect(child.path).toEqual([orgA.root.id, child.id]);
  });

  it("createChild requires a domain for a root-level control", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id);
    await expect(
      caller.control.createChild({
        frameworkId: orgA.framework.id,
        parentId: null,
        title: "Rootless",
        description: "d",
      }),
    ).rejects.toThrow(/domain is required/i);
  });

  it("move cascades path/depth to all descendants of a 3-level subtree", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id);
    // Build: root -> A -> B -> C  (depths 0,1,2,3)
    const a = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: orgA.root.id, title: "A", description: "a" });
    const b = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: a.id, title: "B", description: "b" });
    const c = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: b.id, title: "C", description: "c" });

    expect((await raw(c.id)).depth).toBe(3);
    expect((await raw(c.id)).path).toEqual([orgA.root.id, a.id, b.id, c.id]);

    // Move A to the root (newParentId = null). A,B,C should all shift up one level.
    await caller.control.move({ controlId: a.id, newParentId: null });

    const ra = await raw(a.id);
    const rb = await raw(b.id);
    const rc = await raw(c.id);
    expect(ra).toMatchObject({ parentId: null, depth: 0, path: [a.id] });
    expect(rb).toMatchObject({ parentId: a.id, depth: 1, path: [a.id, b.id] });
    expect(rc).toMatchObject({ parentId: b.id, depth: 2, path: [a.id, b.id, c.id] });
  });

  it("move rejects cyclical re-parenting (into own descendant)", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id);
    const p = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: orgA.root.id, title: "P", description: "p" });
    const q = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: p.id, title: "Q", description: "q" });

    await expect(caller.control.move({ controlId: p.id, newParentId: q.id })).rejects.toThrow(/descendant/i);
    await expect(caller.control.move({ controlId: p.id, newParentId: p.id })).rejects.toThrow(/under itself/i);
  });

  it("getTree returns a nested, org-scoped structure ordered by depth/sortOrder", async () => {
    const local = await seedOrg("Tree");
    const caller = createCaller(local.org.id, local.user.id);
    const fam = await caller.control.createChild({ frameworkId: local.framework.id, parentId: null, title: "Family", description: "f", domain: "Governance" });
    const ctrl = await caller.control.createChild({ frameworkId: local.framework.id, parentId: fam.id, title: "Ctrl", description: "c" });
    await caller.control.createChild({ frameworkId: local.framework.id, parentId: ctrl.id, title: "Enh", description: "e" });

    const tree = await caller.control.getTree({ frameworkId: local.framework.id });
    // Two roots: the seeded root + the new Family.
    const family = tree.roots.find((r) => r.id === fam.id)!;
    expect(family).toBeDefined();
    expect(family.children).toHaveLength(1);
    expect(family.children[0].id).toBe(ctrl.id);
    expect(family.children[0].children[0].title).toBe("Enh");
    expect(family.children[0].children[0].depth).toBe(2);

    await prisma.organization.delete({ where: { id: local.org.id } }).catch(() => undefined);
  });

  it("reorder updates sibling sortOrder and rejects a non-sibling set", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id);
    const s1 = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: orgA.root.id, title: "S1", description: "s1" });
    const s2 = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: orgA.root.id, title: "S2", description: "s2" });

    await caller.control.reorder({ frameworkId: orgA.framework.id, parentId: orgA.root.id, orderedControlIds: [s2.id, s1.id] });
    const rs2 = await prisma.control.findUniqueOrThrow({ where: { id: s2.id }, select: { sortOrder: true } });
    const rs1 = await prisma.control.findUniqueOrThrow({ where: { id: s1.id }, select: { sortOrder: true } });
    expect(rs2.sortOrder).toBe(0);
    expect(rs1.sortOrder).toBe(1);

    // s1 is not a child of s2 → rejected.
    await expect(
      caller.control.reorder({ frameworkId: orgA.framework.id, parentId: s2.id, orderedControlIds: [s1.id] }),
    ).rejects.toThrow(/siblings/i);
  });

  it("delete refuses a parent without cascade, then deletes the whole subtree with cascade", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id);
    const parent = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: orgA.root.id, title: "DelP", description: "p" });
    const kid = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: parent.id, title: "DelK", description: "k" });
    const grandkid = await caller.control.createChild({ frameworkId: orgA.framework.id, parentId: kid.id, title: "DelG", description: "g" });

    await expect(caller.control.delete({ controlId: parent.id, cascade: false })).rejects.toThrow(/cascade/i);

    const res = await caller.control.delete({ controlId: parent.id, cascade: true });
    expect(res.deletedCount).toBe(3);
    expect(await prisma.control.findUnique({ where: { id: grandkid.id } })).toBeNull();
  });

  describe("cross-tenant isolation", () => {
    it("org B cannot read org A's tree, nor move/delete/create under org A controls", async () => {
      const callerB = createCaller(orgB.org.id, orgB.user.id);

      await expect(callerB.control.getTree({ frameworkId: orgA.framework.id })).rejects.toThrow(/not found/i);
      await expect(callerB.control.move({ controlId: orgA.root.id, newParentId: null })).rejects.toThrow(/not found/i);
      await expect(callerB.control.delete({ controlId: orgA.root.id, cascade: true })).rejects.toThrow(/not found/i);
      await expect(
        callerB.control.createChild({ frameworkId: orgA.framework.id, parentId: orgA.root.id, title: "X", description: "x" }),
      ).rejects.toThrow(/not found/i);

      // And org A's control is still intact.
      expect(await prisma.control.findUnique({ where: { id: orgA.root.id } })).not.toBeNull();
    });
  });
});
