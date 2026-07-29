/**
 * Example usage of the EvidenceUploadFlow component
 *
 * This component manages a complete evidence upload and framework-mapping workflow
 * on the dashboard. It handles file selection, validation, AI-powered framework
 * suggestions, and confirmation.
 */

import { EvidenceUploadFlow, type UploadedEvidence } from './EvidenceUploadFlow';

// Basic usage (self-contained, no callbacks)
export function BasicExample() {
  return <EvidenceUploadFlow />;
}

// With success callback to integrate with app state
export function WithCallbackExample() {
  const handleEvidenceUploaded = (evidence: UploadedEvidence) => {
    console.log('Evidence uploaded and assigned:', evidence);
    // Trigger readiness score recalculation
    // Update framework progress
    // Show toast notification
  };

  return <EvidenceUploadFlow onSuccess={handleEvidenceUploaded} />;
}

// Integration example in a dashboard page
export function DashboardIntegration() {
  return (
    <div className="space-y-6">
      <h1>Dashboard</h1>
      {/* Existing cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ... other dashboard cards ... */}
        <EvidenceUploadFlow />
      </div>
    </div>
  );
}
