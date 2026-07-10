import { ConnectorType } from '@prisma/client';
import { ConnectorAdapter } from './types';
import { AWSConnector } from './aws/awsConnector';

export const connectorRegistry: Record<ConnectorType, ConnectorAdapter | null> = {
  [ConnectorType.AWS]: new AWSConnector(),
  [ConnectorType.AZURE]: null, // Coming soon
  [ConnectorType.GCP]: null, // Coming soon
  [ConnectorType.GITHUB]: null, // Coming soon
  [ConnectorType.OKTA]: null, // Coming soon
  [ConnectorType.JIRA]: null, // Coming soon
  [ConnectorType.VERCEL]: null, // Legacy Phase 2 sync (src/workers/connectors/vercel.ts) — not yet on this adapter interface
};

export function getConnectorAdapter(type: ConnectorType): ConnectorAdapter {
  const adapter = connectorRegistry[type];
  if (!adapter) {
    throw new Error(`Connector type ${type} is not yet implemented or supported.`);
  }
  return adapter;
}
