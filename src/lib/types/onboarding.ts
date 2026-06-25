import { z } from 'zod';

// Framework selection enum
export const AvailableFrameworks = {
  DPDP_ACT_2023: 'DPDP Act 2023',
  ISO_27001_2022: 'ISO 27001:2022',
  SOC_2_TYPE_II: 'SOC 2 Type II',
} as const;

export type FrameworkKey = keyof typeof AvailableFrameworks;

// Onboarding steps
export enum OnboardingStep {
  ORGANIZATION_SETUP = 'ORGANIZATION_SETUP',
  FRAMEWORK_SELECTION = 'FRAMEWORK_SELECTION',
  TEAM_SETUP = 'TEAM_SETUP',
  QUICK_START = 'QUICK_START',
  COMPLETION = 'COMPLETION',
}

// Zod schemas for validation
export const OrganizationSetupSchema = z.object({
  organizationName: z
    .string()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name too long'),
  industry: z.string().optional(),
  complianceDeadline: z.date().optional(),
});

export const FrameworkSelectionSchema = z.object({
  frameworks: z
    .array(z.enum(['DPDP_ACT_2023', 'ISO_27001_2022', 'SOC_2_TYPE_II']))
    .min(1, 'Select at least one framework'),
});

export const TeamSetupSchema = z.object({
  teamMembers: z.array(
    z.object({
      email: z.string().email('Invalid email'),
      role: z.enum(['ADMIN', 'COMPLIANCE_MANAGER', 'VIEWER']),
    })
  ),
});

export type OrganizationSetupInput = z.infer<typeof OrganizationSetupSchema>;
export type FrameworkSelectionInput = z.infer<typeof FrameworkSelectionSchema>;
export type TeamSetupInput = z.infer<typeof TeamSetupSchema>;
