/** @jest-environment jsdom */
/**
 * tests/DocumentUploadPanel.test.tsx — Phase 7 Part 3.
 * Ingestion state-machine logic (incl. the FAILED path) + a mount smoke test.
 */
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/trpc", () => ({
  api: {
    aiIngestion: {
      getUploadUrl: { useMutation: () => ({ mutateAsync: jest.fn() }) },
      uploadDocument: { useMutation: () => ({ mutateAsync: jest.fn() }) },
      getDocumentStatus: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

import { render, screen } from "@testing-library/react";
import {
  DocumentUploadPanel,
  ingestionStatusLabel,
  isTerminalStatus,
  ingestionProgressPercent,
} from "@/components/ai-advisor/DocumentUploadPanel";
import type { IngestionStatus } from "@prisma/client";

describe("ingestion state machine", () => {
  const order: IngestionStatus[] = ["PENDING", "CHUNKING", "EMBEDDING", "GRAPH_EXTRACTING", "COMPLETED"];

  it("labels every status, including FAILED", () => {
    for (const s of [...order, "FAILED" as IngestionStatus]) {
      expect(ingestionStatusLabel(s)).toBeTruthy();
    }
    expect(ingestionStatusLabel("FAILED")).toBe("Failed");
  });

  it("treats only COMPLETED and FAILED as terminal", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("EMBEDDING")).toBe(false);
    expect(isTerminalStatus("PENDING")).toBe(false);
  });

  it("advances progress monotonically through the pipeline", () => {
    const percents = order.map(ingestionProgressPercent);
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThan(percents[i - 1]);
    expect(ingestionProgressPercent("COMPLETED")).toBe(100);
    expect(ingestionProgressPercent("FAILED")).toBe(100);
  });
});

describe("DocumentUploadPanel", () => {
  it("mounts with an accessible file input and choose-file control", () => {
    render(<DocumentUploadPanel />);
    expect(screen.getByLabelText(/upload a document for the advisor/i)).toBeInTheDocument();
    expect(screen.getByText(/choose file/i)).toBeInTheDocument();
  });
});
