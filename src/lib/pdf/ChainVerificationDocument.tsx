import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { format } from "date-fns";
import { pdfPalette } from "@/lib/pdf/palette";

/**
 * GH #26 — the artefact an auditor is handed instead of a screenshot.
 *
 * The document is written to be read by someone who does not trust us. That
 * shapes three choices a normal report would not make:
 *
 *   1. It states the RANGE and the ENTRY COUNT prominently. A verification
 *      result with no scope is unfalsifiable — "the chain is intact" means
 *      nothing without "over these 41,882 entries, from this date to this one".
 *   2. It says so when a check is PARTIAL. A range-bounded verification cannot
 *      prove nothing was deleted before the range, and an auditor who is not
 *      told that has been misled by omission.
 *   3. It documents how to reproduce the result independently. The point of a
 *      hash chain is that our say-so is not required.
 */

export interface ChainVerificationReportData {
  organizationName: string;
  ok: boolean;
  reason: string | null;
  brokenAtId: string | null;
  brokenAtTimestamp: Date | null;
  totalChecked: number;
  rangeFrom: Date | null;
  rangeTo: Date | null;
  checkedAt: Date;
  partial: boolean;
  trigger: string;
  verificationId: string;
}

const styles = StyleSheet.create({
  page: {
    flexDirection: "column",
    backgroundColor: pdfPalette.surface,
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 11,
  },
  header: {
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: pdfPalette.primary,
  },
  title: { fontSize: 22, fontWeight: "bold", color: pdfPalette.text, marginBottom: 5 },
  subtitle: { fontSize: 11, color: pdfPalette.textMuted, marginBottom: 3 },
  verdict: {
    padding: 16,
    marginTop: 10,
    marginBottom: 20,
    borderWidth: 2,
    borderRadius: 4,
  },
  verdictPass: { borderColor: pdfPalette.success, backgroundColor: pdfPalette.surfaceMuted },
  verdictFail: { borderColor: pdfPalette.critical, backgroundColor: pdfPalette.surfaceMuted },
  verdictText: { fontSize: 16, fontWeight: "bold" },
  verdictPassText: { color: pdfPalette.success },
  verdictFailText: { color: pdfPalette.critical },
  verdictDetail: { fontSize: 10, color: pdfPalette.textMuted, marginTop: 6 },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: pdfPalette.primary,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: pdfPalette.border,
  },
  row: { flexDirection: "row", marginBottom: 5 },
  label: { width: 170, color: pdfPalette.textMuted, fontSize: 10 },
  value: { flex: 1, fontSize: 10, color: pdfPalette.text },
  mono: { fontFamily: "Courier", fontSize: 9 },
  caveat: {
    marginTop: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: pdfPalette.warning,
    backgroundColor: pdfPalette.surfaceMuted,
    fontSize: 9,
    color: pdfPalette.text,
  },
  body: { fontSize: 9, color: pdfPalette.textMuted, lineHeight: 1.5 },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: pdfPalette.textMuted,
    borderTopWidth: 1,
    borderTopColor: pdfPalette.border,
    paddingTop: 8,
  },
});

const fmt = (d: Date | null, fallback: string) =>
  d ? format(d, "d MMM yyyy HH:mm:ss 'UTC'") : fallback;

export function ChainVerificationDocument({ data }: { data: ChainVerificationReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Audit Log Integrity Verification</Text>
          <Text style={styles.subtitle}>{data.organizationName}</Text>
          <Text style={styles.subtitle}>
            Verification {data.verificationId} · {data.trigger.toLowerCase()} run
          </Text>
        </View>

        <View style={[styles.verdict, data.ok ? styles.verdictPass : styles.verdictFail]}>
          <Text style={[styles.verdictText, data.ok ? styles.verdictPassText : styles.verdictFailText]}>
            {data.ok ? "CHAIN INTACT" : "CHAIN VERIFICATION FAILED"}
          </Text>
          <Text style={styles.verdictDetail}>
            {data.ok
              ? `All ${data.totalChecked.toLocaleString()} audit entries in the range below hash-verified against their recorded chain. No entry was altered, deleted, reordered, or inserted.`
              : `Verification stopped at the first divergence after checking ${data.totalChecked.toLocaleString()} entries. ${data.reason ?? ""}`}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scope of this verification</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Range start</Text>
            <Text style={styles.value}>{fmt(data.rangeFrom, "beginning of the chain")}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Range end</Text>
            <Text style={styles.value}>{fmt(data.rangeTo, "most recent entry")}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Entries checked</Text>
            <Text style={styles.value}>{data.totalChecked.toLocaleString()}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Verification performed</Text>
            <Text style={styles.value}>{fmt(data.checkedAt, "—")}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Algorithm</Text>
            <Text style={styles.value}>SHA-256 linked hash chain</Text>
          </View>

          {data.partial && (
            <Text style={styles.caveat}>
              PARTIAL VERIFICATION. This run began at a specified start date rather than at the
              first entry in the chain, so the first checked entry&apos;s back-link could not be
              compared against its predecessor. This result establishes that the entries WITHIN
              the range are internally consistent. It does not establish that no entry was
              removed BEFORE the range. For an unqualified result, run a verification with no
              start date.
            </Text>
          )}
        </View>

        {!data.ok && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Point of divergence</Text>
            <View style={styles.row}>
              <Text style={styles.label}>First divergent entry</Text>
              <Text style={[styles.value, styles.mono]}>{data.brokenAtId ?? "—"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Recorded timestamp</Text>
              <Text style={styles.value}>{fmt(data.brokenAtTimestamp, "—")}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Nature of divergence</Text>
              <Text style={styles.value}>{data.reason ?? "—"}</Text>
            </View>
            <Text style={styles.caveat}>
              Entries BEFORE this point verified successfully. The divergence indicates that this
              entry, or the sequence immediately preceding it, no longer matches what was written.
              Entries after this point were not checked: once a chain diverges, subsequent links
              cannot be meaningfully evaluated against it.
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How to reproduce this result independently</Text>
          <Text style={styles.body}>
            Every audit entry stores the hash of the entry before it. Verification recomputes,
            for each entry in sequence, the SHA-256 of its organization, actor, action, entity,
            entity id, change payload, timestamp, and the preceding entry&apos;s hash — then
            compares that against the hash stored on the entry. Two conditions must hold for
            every entry: its stored back-link must equal the previous entry&apos;s hash, and its
            recomputed hash must equal its stored hash. The first fails if an entry was deleted,
            inserted or reordered; the second fails if an entry&apos;s contents were altered in
            place. Export the audit log over the same range and repeat this computation to
            confirm this result without relying on Dharma to perform it.
          </Text>
        </View>

        <Text style={styles.footer} fixed>
          Generated by Dharma · This document is HMAC-signed; a modified copy will fail signature
          verification. Verification id {data.verificationId}.
        </Text>
      </Page>
    </Document>
  );
}
