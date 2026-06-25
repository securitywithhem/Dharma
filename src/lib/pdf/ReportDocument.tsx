import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from '@react-pdf/renderer';
import { ReportData } from '@/lib/services/reportGenerator';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 11,
  },
  header: {
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#D97706',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1C1917',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: '#78716C',
    marginBottom: 10,
  },
  section: {
    marginBottom: 20,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#D97706',
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E5E4',
  },
  table: {
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  tableHeader: {
    backgroundColor: '#F5F5F4',
    fontWeight: 'bold',
    color: '#1C1917',
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableCell: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: '#E7E5E4',
  },
  tableCellLast: {
    borderRightWidth: 0,
  },
  footer: {
    marginTop: 30,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E7E5E4',
    fontSize: 9,
    color: '#78716C',
    textAlign: 'center',
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 'bold',
  },
  badgeCompliant: {
    backgroundColor: '#D1FAE5',
    color: '#065F46',
  },
  badgeInProgress: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
  },
  badgeNotStarted: {
    backgroundColor: '#F3F4F6',
    color: '#374151',
  },
  scoreCard: {
    backgroundColor: '#F9FAFB',
    padding: 15,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#D97706',
  },
  scoreValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#D97706',
  },
  scoreLabel: {
    fontSize: 12,
    color: '#78716C',
    marginTop: 5,
  },
});

interface ReportDocumentProps {
  data: ReportData;
}

export function ReportDocument({ data }: ReportDocumentProps) {
  const getBadgeStyle = (status: string) => {
    switch (status) {
      case 'COMPLIANT':
        return [styles.badge, styles.badgeCompliant];
      case 'IN_PROGRESS':
        return [styles.badge, styles.badgeInProgress];
      default:
        return [styles.badge, styles.badgeNotStarted];
    }
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Dharma Compliance Report</Text>
          <Text style={styles.subtitle}>
            Organization: {data.organization.name}
          </Text>
          <Text style={styles.subtitle}>
            Generated: {format(data.reportGeneratedAt, 'PPpp')}
          </Text>
        </View>

        {/* Compliance Score Card */}
        <View style={styles.scoreCard}>
          <Text style={styles.scoreValue}>{data.complianceScore}%</Text>
          <Text style={styles.scoreLabel}>
            Overall Compliance Readiness
          </Text>
          <Text style={styles.scoreLabel} key="status">
            Audit Log Status: {data.verificationStatus}
          </Text>
        </View>

        {/* Executive Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Executive Summary</Text>
          <Text>
            This report provides a comprehensive overview of compliance status
            across {data.frameworks.length} framework{data.frameworks.length !== 1 ? 's' : ''}.
          </Text>
          <Text style={{ marginTop: 5 }}>
            {data.policies.length} policies have been published and are
            currently in effect.
          </Text>
        </View>

        {/* Frameworks Section */}
        {data.frameworks.map((framework, fwIndex) => (
          <View key={fwIndex} style={styles.section}>
            <Text style={styles.sectionTitle}>
              {framework.name} (v{framework.version}) – {framework.progressPercentage}%
              Complete
            </Text>

            {/* Domains Table */}
            {framework.domains.map((domain, dIndex) => (
              <View key={dIndex} style={{ marginBottom: 15 }}>
                <Text style={{ fontWeight: 'bold', marginBottom: 5 }}>
                  {domain.name}
                </Text>
                <View style={styles.table}>
                  <View
                    style={{
                      flexDirection: 'row',
                      borderBottomWidth: 1,
                      borderBottomColor: '#E7E5E4',
                    }}
                  >
                    <Text
                      style={[
                        styles.tableHeader,
                        { flex: 2 },
                      ]}
                    >
                      Control
                    </Text>
                    <Text
                      style={[
                        styles.tableHeader,
                        { flex: 1 },
                      ]}
                    >
                      Status
                    </Text>
                    <Text
                      style={[
                        styles.tableHeader,
                        { flex: 1 },
                        styles.tableCellLast,
                      ]}
                    >
                      Evidence
                    </Text>
                  </View>
                  {domain.controls.map((control) => (
                    <View
                      key={control.id}
                      style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E7E5E4' }}
                    >
                      <Text style={[styles.tableCell, { flex: 2 }]}>
                        {control.title}
                      </Text>
                      <Text style={[styles.tableCell, { flex: 1 }]}>
                        <Text style={getBadgeStyle(control.status) as any}>
                          {control.status.replace(/_/g, ' ')}
                        </Text>
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          { flex: 1 },
                          styles.tableCellLast,
                        ]}
                      >
                        {control.evidenceCount}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ))}

        {/* Policies Section */}
        {data.policies.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Published Policies</Text>
            {data.policies.map((policy, pIndex) => (
              <Text key={pIndex} style={{ marginBottom: 5 }}>
                • {policy.title} (v{policy.version}) – Updated{' '}
                {format(new Date(policy.updatedAt), 'PPP')}
              </Text>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text>
            This report is confidential and intended for internal use and audit
            purposes.
          </Text>
          <Text>
            Organization: {data.organization.id} | Generated:{' '}
            {format(data.reportGeneratedAt, 'yyyy-MM-dd HH:mm:ss')}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
