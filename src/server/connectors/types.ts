export interface EvidenceItem {
  id: string;
  type: string;
  fileName: string;
  fileContent?: Buffer;
  summary?: string;
  collectedAt: Date;
  metadata?: any;
}

export interface ConnectorAdapter {
  /**
   * Tests the connection to the external service using the provided config.
   * Throws an error if the connection fails.
   */
  testConnection(config: any): Promise<boolean>;

  /**
   * Lists available evidence types that this connector can collect.
   */
  listAvailableEvidenceTypes(): string[];

  /**
   * Collects evidence for a given type.
   */
  collectEvidence(type: string, config: any): Promise<EvidenceItem[]>;
}
