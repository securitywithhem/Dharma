/**
 * prisma/seed-templates.ts
 *
 * Phase 2 Feature 4 — Seeds PolicyTemplate rows from .md.hbs template files.
 *
 * Run with: npx ts-node -e "require('./prisma/seed-templates.ts')"
 * Or via npm script: npm run seed:templates
 *
 * Safe to run multiple times — upserts on (policyType, name, version).
 */

import { PrismaClient, PolicyType } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

// Template definitions — describes variables for each template.
// Variable schema: { key, label, type: 'text'|'date'|'email'|'boolean', required, defaultValue? }
const TEMPLATES: Array<{
  policyType: PolicyType;
  name: string;
  version: string;
  file: string;
  variables: Array<{
    key: string;
    label: string;
    type: "text" | "date" | "email" | "boolean";
    required: boolean;
    defaultValue?: string;
  }>;
}> = [
  {
    policyType: PolicyType.PRIVACY_POLICY,
    name: "DPDP Act 2023 Privacy Policy",
    version: "1.0",
    file: "PRIVACY_POLICY.md.hbs",
    variables: [
      { key: "organizationName", label: "Organisation Name", type: "text", required: true },
      { key: "effectiveDate", label: "Effective Date", type: "date", required: true },
      { key: "policyVersion", label: "Policy Version", type: "text", required: true, defaultValue: "1.0" },
      { key: "lastReviewedDate", label: "Last Reviewed Date", type: "date", required: true },
      { key: "registeredAddress", label: "Registered Address", type: "text", required: true },
      { key: "serviceUrl", label: "Service URL", type: "text", required: true },
      { key: "dpoName", label: "Data Protection Officer Name", type: "text", required: true },
      { key: "dpoEmail", label: "DPO Email", type: "email", required: true },
      { key: "responseTimeDays", label: "Response SLA (working days)", type: "text", required: true, defaultValue: "30" },
      { key: "serviceName", label: "Service / Product Name", type: "text", required: true },
      { key: "processSensitiveData", label: "Process Sensitive Data?", type: "boolean", required: false, defaultValue: "false" },
      { key: "sensitiveDataCategories", label: "Sensitive Data Categories (if applicable)", type: "text", required: false },
      { key: "postAccountRetentionDays", label: "Post-Account Retention (days)", type: "text", required: true, defaultValue: "90" },
      { key: "transactionRetentionYears", label: "Transaction Record Retention (years)", type: "text", required: true, defaultValue: "7" },
      { key: "securityLogRetentionDays", label: "Security Log Retention (days)", type: "text", required: true, defaultValue: "180" },
      { key: "hasInternationalTransfers", label: "International Data Transfers?", type: "boolean", required: false, defaultValue: "false" },
      { key: "transferDestinations", label: "Transfer Destination Countries (if applicable)", type: "text", required: false },
      { key: "breachNotificationHours", label: "Breach Notification SLA (hours)", type: "text", required: true, defaultValue: "72" },
      { key: "additionalSecurityMeasures", label: "Additional Security Measures", type: "text", required: false },
      { key: "cookiePolicyUrl", label: "Cookie Policy URL", type: "text", required: false },
    ],
  },
  {
    policyType: PolicyType.DATA_RETENTION,
    name: "DPDP Act 2023 Data Retention Policy",
    version: "1.0",
    file: "DATA_RETENTION.md.hbs",
    variables: [
      { key: "organizationName", label: "Organisation Name", type: "text", required: true },
      { key: "effectiveDate", label: "Effective Date", type: "date", required: true },
      { key: "policyVersion", label: "Policy Version", type: "text", required: true, defaultValue: "1.0" },
      { key: "policyOwner", label: "Policy Owner", type: "text", required: true },
      { key: "dataOwner", label: "Data Owner", type: "text", required: true },
      { key: "crmSystem", label: "CRM System Name", type: "text", required: false, defaultValue: "CRM" },
      { key: "hrSystem", label: "HR System Name", type: "text", required: false, defaultValue: "HRMS" },
      { key: "payrollSystem", label: "Payroll System Name", type: "text", required: false, defaultValue: "Payroll" },
      { key: "accountingSystem", label: "Accounting System Name", type: "text", required: false, defaultValue: "ERP" },
      { key: "siemSystem", label: "SIEM / Log System Name", type: "text", required: false, defaultValue: "SIEM" },
      { key: "supportSystem", label: "Support System Name", type: "text", required: false, defaultValue: "Helpdesk" },
      { key: "marketingSystem", label: "Marketing System Name", type: "text", required: false, defaultValue: "CRM" },
      { key: "analyticsSystem", label: "Analytics System Name", type: "text", required: false, defaultValue: "Analytics" },
      { key: "postAccountDays", label: "Post-Account Retention (days)", type: "text", required: true, defaultValue: "90" },
      { key: "postEmploymentYears", label: "Post-Employment Retention (years)", type: "text", required: true, defaultValue: "7" },
      { key: "payrollRetentionYears", label: "Payroll Retention (years)", type: "text", required: true, defaultValue: "8" },
      { key: "financialRetentionYears", label: "Financial Records Retention (years)", type: "text", required: true, defaultValue: "8" },
      { key: "securityLogDays", label: "Security Log Retention (days)", type: "text", required: true, defaultValue: "180" },
      { key: "supportRetentionDays", label: "Support Ticket Retention (days)", type: "text", required: true, defaultValue: "730" },
      { key: "consentRetentionYears", label: "Marketing Consent Retention (years)", type: "text", required: true, defaultValue: "3" },
      { key: "analyticsRetentionMonths", label: "Analytics Retention (months)", type: "text", required: true, defaultValue: "26" },
      { key: "legalContact", label: "Legal Contact / Counsel Name", type: "text", required: true },
      { key: "processorReviewFrequency", label: "Processor Review Frequency", type: "text", required: true, defaultValue: "annually" },
      { key: "nextReviewDate", label: "Next Review Date", type: "date", required: true },
    ],
  },
  {
    policyType: PolicyType.ACCESS_CONTROL,
    name: "DPDP Act 2023 Access Control Policy",
    version: "1.0",
    file: "ACCESS_CONTROL.md.hbs",
    variables: [
      { key: "organizationName", label: "Organisation Name", type: "text", required: true },
      { key: "effectiveDate", label: "Effective Date", type: "date", required: true },
      { key: "policyVersion", label: "Policy Version", type: "text", required: true, defaultValue: "1.0" },
      { key: "policyOwner", label: "Policy Owner", type: "text", required: true },
      { key: "approvalAuthority", label: "Access Approval Authority", type: "text", required: true },
      { key: "identityVerificationMethod", label: "Identity Verification Method", type: "text", required: true, defaultValue: "government-issued ID" },
      { key: "provisioningSLA", label: "Account Provisioning SLA (hours)", type: "text", required: true, defaultValue: "24" },
      { key: "regularReviewFrequency", label: "Regular Access Review Frequency", type: "text", required: true, defaultValue: "Semi-annually" },
      { key: "accessReviewOwner", label: "Access Review Owner", type: "text", required: true },
      { key: "terminationDeactivationHours", label: "Termination Deactivation SLA (hours)", type: "text", required: true, defaultValue: "4" },
      { key: "minPasswordLength", label: "Minimum Password Length", type: "text", required: true, defaultValue: "12" },
      { key: "passwordHistoryCount", label: "Password History Count", type: "text", required: true, defaultValue: "12" },
      { key: "passwordExpiryDays", label: "Password Expiry (days)", type: "text", required: true, defaultValue: "90" },
      { key: "privilegedSessionLog", label: "Privileged Session Log System", type: "text", required: true },
      { key: "privilegedReviewOwner", label: "Privileged Access Review Owner", type: "text", required: true },
      { key: "thirdPartyReviewOwner", label: "Third-Party Access Review Owner", type: "text", required: true },
      { key: "accessLogRetentionDays", label: "Access Log Retention (days)", type: "text", required: true, defaultValue: "180" },
      { key: "logReviewFrequency", label: "Log Review Frequency", type: "text", required: true, defaultValue: "weekly" },
      { key: "securityTeam", label: "Security Team Name / Role", type: "text", required: true },
    ],
  },
  {
    policyType: PolicyType.INCIDENT_RESPONSE,
    name: "DPDP Act 2023 Incident Response Policy",
    version: "1.0",
    file: "INCIDENT_RESPONSE.md.hbs",
    variables: [
      { key: "organizationName", label: "Organisation Name", type: "text", required: true },
      { key: "effectiveDate", label: "Effective Date", type: "date", required: true },
      { key: "policyVersion", label: "Policy Version", type: "text", required: true, defaultValue: "1.0" },
      { key: "policyOwner", label: "Policy Owner", type: "text", required: true },
      { key: "p1DataSubjectThreshold", label: "P1 Data Subject Threshold", type: "text", required: true, defaultValue: "1,000" },
      { key: "p1ContainmentHours", label: "P1 Containment SLA (hours)", type: "text", required: true, defaultValue: "4" },
      { key: "p2ContainmentHours", label: "P2 Containment SLA (hours)", type: "text", required: true, defaultValue: "12" },
      { key: "p3ResponseHours", label: "P3 Response SLA (hours)", type: "text", required: true, defaultValue: "24" },
      { key: "p4ResponseHours", label: "P4 Response SLA (hours)", type: "text", required: true, defaultValue: "72" },
      { key: "incidentCommanderContact", label: "Incident Commander Contact", type: "text", required: true },
      { key: "technicalLeadContact", label: "Technical Lead Contact", type: "text", required: true },
      { key: "dpoContact", label: "DPO Contact", type: "email", required: true },
      { key: "communicationsContact", label: "Communications Contact", type: "text", required: true },
      { key: "executiveSponsorContact", label: "Executive Sponsor Contact", type: "text", required: true },
      { key: "incidentReportEmail", label: "Incident Report Email", type: "email", required: true },
      { key: "incidentHotline", label: "Incident Hotline Number", type: "text", required: true },
      { key: "employeeReportingSLAHours", label: "Employee Reporting SLA (hours)", type: "text", required: true, defaultValue: "2" },
      { key: "siemPlatform", label: "SIEM Platform Name", type: "text", required: true },
      { key: "incidentTrackingSystem", label: "Incident Tracking System", type: "text", required: true },
      { key: "pirDeadlineDays", label: "Post-Incident Review Deadline (days)", type: "text", required: true, defaultValue: "14" },
      { key: "boardNotificationHours", label: "Board Notification SLA (hours)", type: "text", required: true, defaultValue: "72" },
      { key: "principalNotificationHours", label: "Data Principal Notification SLA (hours)", type: "text", required: true, defaultValue: "72" },
      { key: "incidentEvidenceRetentionYears", label: "Evidence Retention (years)", type: "text", required: true, defaultValue: "5" },
      { key: "tabletopFrequency", label: "Tabletop Exercise Frequency", type: "text", required: true, defaultValue: "quarterly" },
    ],
  },
];

async function seedTemplates() {
  console.log("🌱 Seeding policy templates...");

  const templatesDir = join(process.cwd(), "content/policy-templates");

  let created = 0;
  let skipped = 0;

  for (const tmpl of TEMPLATES) {
    let bodyTemplate: string;
    try {
      bodyTemplate = readFileSync(join(templatesDir, tmpl.file), "utf-8");
    } catch (err) {
      console.warn(`⚠️  Template file not found: ${tmpl.file} — skipping`);
      skipped++;
      continue;
    }

    await prisma.policyTemplate.upsert({
      where: {
        policyType_name_version: {
          policyType: tmpl.policyType,
          name: tmpl.name,
          version: tmpl.version,
        },
      },
      create: {
        policyType: tmpl.policyType,
        name: tmpl.name,
        version: tmpl.version,
        bodyTemplate,
        variables: tmpl.variables,
        isActive: true,
      },
      update: {
        bodyTemplate,
        variables: tmpl.variables,
        isActive: true,
      },
    });

    console.log(`✅  Upserted: ${tmpl.name} v${tmpl.version}`);
    created++;
  }

  console.log(`\n🌱 Seeding complete — ${created} templates upserted, ${skipped} skipped.`);
}

seedTemplates()
  .catch((err) => {
    console.error("❌ Template seeding failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
