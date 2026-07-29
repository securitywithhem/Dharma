"use client";

import React, { useState } from "react";
import { ConnectorsList } from "@/components/connectors/ConnectorsList";
import { ConnectorConfigWizard } from "@/components/connectors/ConnectorConfigWizard";

export default function ConnectorsSettingsPage() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Connectors</h2>
          <p className="text-dharma-ink-secondary">
            Manage your automated evidence collection integrations.
          </p>
        </div>
        <button
          onClick={() => setIsWizardOpen(true)}
          className="bg-dharma-accent text-dharma-ink-inverse hover:bg-dharma-accent-hover h-10 px-4 py-2 rounded-md"
        >
          Add Connector
        </button>
      </div>

      <ConnectorsList />

      {isWizardOpen && (
        <ConnectorConfigWizard onClose={() => setIsWizardOpen(false)} />
      )}
    </div>
  );
}
