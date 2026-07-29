// Phase 9 Part 2 — CUSTOM_PDF renderer. Renders only the sections present in
// the aggregated data (empty sections simply don't appear). Reuses the visual
// language (amber accent, stone text) of the existing ReportDocument.
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { CustomReportData } from "@/server/services/reportData";
import { pdfPalette } from '@/lib/pdf/palette';

const styles = StyleSheet.create({
  page: { flexDirection: "column", backgroundColor: pdfPalette.surface, padding: 40, fontFamily: "Helvetica", fontSize: 11 },
  header: { marginBottom: 20, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: pdfPalette.primary },
  title: { fontSize: 22, fontWeight: "bold", color: pdfPalette.text, marginBottom: 4 },
  subtitle: { fontSize: 11, color: pdfPalette.textMuted },
  section: { marginBottom: 18, marginTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "bold", color: pdfPalette.primary, marginBottom: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: pdfPalette.border },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: pdfPalette.surfaceMuted },
  cell: { fontSize: 10, color: pdfPalette.text },
  cellMuted: { fontSize: 10, color: pdfPalette.textMuted },
  scoreBarTrack: { height: 8, backgroundColor: pdfPalette.border, borderRadius: 4, marginTop: 2, width: 120 },
  scoreBarFill: { height: 8, backgroundColor: pdfPalette.primary, borderRadius: 4 },
  empty: { fontSize: 10, color: pdfPalette.textMuted, fontStyle: "italic" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: pdfPalette.textMuted, textAlign: "center", borderTopWidth: 1, borderTopColor: pdfPalette.border, paddingTop: 6 },
});

function CountRows({ record }: { record: Record<string, number> }) {
  const entries = Object.entries(record);
  if (entries.length === 0) return <Text style={styles.empty}>None recorded for this period.</Text>;
  return (
    <>
      {entries.map(([k, v]) => (
        <View style={styles.row} key={k}>
          <Text style={styles.cell}>{k}</Text>
          <Text style={styles.cellMuted}>{v}</Text>
        </View>
      ))}
    </>
  );
}

export function CustomReportDocument({ data, title }: { data: CustomReportData; title: string }) {
  const { sections } = data;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {data.organizationName} · Generated {new Date(data.generatedAt).toLocaleString()}
            {data.dateRange.from || data.dateRange.to
              ? ` · Range ${data.dateRange.from ?? "—"} to ${data.dateRange.to ?? "—"}`
              : ""}
          </Text>
        </View>

        {sections.frameworkReadiness && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Framework readiness</Text>
            {sections.frameworkReadiness.length === 0 ? (
              <Text style={styles.empty}>No frameworks configured.</Text>
            ) : (
              sections.frameworkReadiness.map((fw) => (
                <View style={styles.row} key={fw.frameworkId}>
                  <Text style={styles.cell}>{fw.frameworkName}</Text>
                  <View>
                    <Text style={styles.cellMuted}>{fw.overallScore}/100</Text>
                    <View style={styles.scoreBarTrack}>
                      <View style={[styles.scoreBarFill, { width: `${Math.min(100, fw.overallScore)}%` }]} />
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {sections.evidenceStatus && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Evidence status ({sections.evidenceStatus.total} items)</Text>
            <Text style={styles.cellMuted}>By type</Text>
            <CountRows record={sections.evidenceStatus.byType} />
            <Text style={[styles.cellMuted, { marginTop: 6 }]}>By source</Text>
            <CountRows record={sections.evidenceStatus.bySource} />
          </View>
        )}

        {sections.vulnerabilityTrend && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vulnerability trend ({sections.vulnerabilityTrend.total} total)</Text>
            <Text style={styles.cellMuted}>By severity</Text>
            <CountRows record={sections.vulnerabilityTrend.bySeverity} />
            <Text style={[styles.cellMuted, { marginTop: 6 }]}>By status</Text>
            <CountRows record={sections.vulnerabilityTrend.byStatus} />
          </View>
        )}

        {sections.endpointCompliance && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Endpoint compliance ({sections.endpointCompliance.total} endpoints)</Text>
            <Text style={styles.cellMuted}>By status</Text>
            <CountRows record={sections.endpointCompliance.byStatus} />
            <View style={styles.row}>
              <Text style={styles.cell}>Passing checks</Text>
              <Text style={styles.cellMuted}>{sections.endpointCompliance.passingChecks}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.cell}>Failing checks</Text>
              <Text style={styles.cellMuted}>{sections.endpointCompliance.failingChecks}</Text>
            </View>
          </View>
        )}

        <Text style={styles.footer} fixed>
          Dharma compliance report — confidential. Figures reflect data at generation time.
        </Text>
      </Page>
    </Document>
  );
}
