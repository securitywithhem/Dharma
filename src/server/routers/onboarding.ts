import { z } from 'zod';
import { createTRPCRouter, orgProcedure } from '../trpc';
import {
  OrganizationSetupSchema,
  FrameworkSelectionSchema,
  TeamSetupSchema,
} from '@/lib/types/onboarding';
import { TRPCError } from '@trpc/server';
import { createAuditLog } from '@/server/audit-log';

export const onboardingRouter = createTRPCRouter({
  /**
   * Check if organization onboarding is complete.
   */
  getOnboardingStatus: orgProcedure.query(async ({ ctx }) => {
    const { prisma, session } = ctx;
    const organizationId = session.user.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { frameworks: { select: { id: true } } },
    });

    // Onboarding is complete if organization has at least one framework
    const isComplete = org && org.frameworks.length > 0;

    return { isComplete, organizationId };
  }),

  /**
   * Setup organization (update name, add metadata).
   */
  setupOrganization: orgProcedure
    .input(OrganizationSetupSchema)
    .mutation(async ({ input, ctx }) => {
      const { organizationName, industry, complianceDeadline } = input;
      const { prisma, session } = ctx;
      const organizationId = session.user.organizationId;

      // Update organization
      const org = await prisma.organization.update({
        where: { id: organizationId },
        data: {
          name: organizationName,
        },
      });

      // Log to audit trail
      await createAuditLog(prisma, {
        organizationId,
        userId: session.user.id,
        action: 'ORGANIZATION_SETUP',
        entity: 'Organization',
        entityId: organizationId,
        changes: { organizationName, industry },
      });

      return { success: true, organizationId: org.id };
    }),

  /**
   * Select and seed frameworks.
   * Creates Framework records and seeds their controls.
   */
  selectFrameworks: orgProcedure
    .input(FrameworkSelectionSchema)
    .mutation(async ({ input, ctx }) => {
      const { frameworks: selectedFrameworks } = input;
      const { prisma, session } = ctx;
      const organizationId = session.user.organizationId;

      const frameworkMetadata = {
        DPDP_ACT_2023: {
          name: 'Digital Personal Data Protection Act 2023',
          version: '1.0',
          domains: [
            'Consent & Notice',
            'Data Principal Rights',
            'Data Fiduciary Duties',
            'Grievance Redressal',
          ],
        },
        ISO_27001_2022: {
          name: 'ISO 27001:2022',
          version: '2022',
          domains: [
            'Governance',
            'Access Control',
            'Cryptography',
            'Physical & Environmental Security',
            'Incident Management',
          ],
        },
        SOC_2_TYPE_II: {
          name: 'SOC 2 Type II',
          version: '2023',
          domains: [
            'Security',
            'Availability',
            'Processing Integrity',
            'Confidentiality',
            'Privacy',
          ],
        },
      };

      const createdFrameworks = [];

      for (const frameworkKey of selectedFrameworks) {
        const metadata = frameworkMetadata[frameworkKey as keyof typeof frameworkMetadata];

        if (!metadata) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unknown framework: ${frameworkKey}`,
          });
        }

        // Check if framework already exists
        const existing = await prisma.framework.findFirst({
            where: {
                organizationId,
                name: metadata.name
            }
        });
        
        if (existing) {
            continue; // Skip if already added
        }

        // Create framework
        const framework = await prisma.framework.create({
          data: {
            name: metadata.name,
            version: metadata.version,
            organizationId,
          },
        });

        // Seed controls for each domain (placeholder)
        for (const domain of metadata.domains) {
          await prisma.control.create({
            data: {
              frameworkId: framework.id,
              domain,
              title: `${domain} Control`,
              description: `Implement and maintain ${domain.toLowerCase()} controls as per ${metadata.name}.`,
              status: 'NOT_STARTED',
            },
          });
        }

        createdFrameworks.push({
          id: framework.id,
          name: framework.name,
          controlCount: metadata.domains.length,
        });
      }

      // Log to audit trail
      await createAuditLog(prisma, {
        organizationId,
        userId: session.user.id,
        action: 'FRAMEWORKS_SELECTED',
        entity: 'Framework',
        entityId: organizationId,
        changes: { selectedFrameworks },
      });

      return { success: true, frameworks: createdFrameworks };
    }),

  /**
   * Invite team members.
   * Creates user records or sends invitations to existing emails.
   */
  inviteTeamMembers: orgProcedure
    .input(TeamSetupSchema)
    .mutation(async ({ input, ctx }) => {
      const { teamMembers } = input;
      const { prisma, session } = ctx;
      const organizationId = session.user.organizationId;

      // Verify user is ADMIN
      if (session.user.role !== 'ADMIN') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only admins can invite team members',
        });
      }

      const invitedUsers = [];

      for (const member of teamMembers) {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: member.email },
        });

        if (existingUser) {
          if (existingUser.organizationId !== organizationId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `User ${member.email} is already part of another organization`,
            });
          }
          // Update role if user already in org
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { role: member.role as any },
          });
          invitedUsers.push({ email: member.email, status: 'UPDATED' });
        } else {
          // Create new user with role
          const newUser = await prisma.user.create({
            data: {
              email: member.email,
              organizationId,
              role: member.role as any,
            },
          });
          invitedUsers.push({ email: member.email, status: 'INVITED' });

          // TODO: Send invitation email via SendGrid or similar
          console.log(`📧 Invitation email would be sent to: ${member.email}`);
        }
      }

      // Log to audit trail
      await createAuditLog(prisma, {
        organizationId,
        userId: session.user.id,
        action: 'TEAM_INVITED',
        entity: 'User',
        entityId: organizationId,
        changes: { invitedCount: teamMembers.length },
      });

      return { success: true, invitedUsers };
    }),

  /**
   * Mark onboarding as complete.
   */
  completeOnboarding: orgProcedure.mutation(async ({ ctx }) => {
    const { prisma, session } = ctx;
    const organizationId = session.user.organizationId;

    // Verify frameworks are selected
    const frameworks = await prisma.framework.findMany({
      where: { organizationId },
    });

    if (frameworks.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Select at least one framework before completing onboarding',
      });
    }

    // Log completion
    await createAuditLog(prisma, {
      organizationId,
      userId: session.user.id,
      action: 'ONBOARDING_COMPLETED',
      entity: 'Organization',
      entityId: organizationId,
      changes: null,
    });

    return { success: true };
  }),
});
