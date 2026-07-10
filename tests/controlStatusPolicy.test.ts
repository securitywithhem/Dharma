import { ControlStatus } from "@prisma/client";
import { deriveControlStatus } from "@/server/connectors/controlStatusPolicy";
import type { EvidenceItem } from "@/server/connectors/types";

function item(status: EvidenceItem["status"], id = "1"): EvidenceItem {
  return {
    id,
    type: "aws_cloudtrail_enabled",
    fileName: `${id}.json`,
    collectedAt: new Date(),
    status,
  };
}

describe("deriveControlStatus", () => {
  const startingStatuses: ControlStatus[] = [
    ControlStatus.NOT_STARTED,
    ControlStatus.IN_PROGRESS,
    ControlStatus.COMPLIANT,
  ];

  it.each(startingStatuses)(
    "returns COMPLIANT when all items pass (from %s)",
    (currentStatus) => {
      const result = deriveControlStatus(
        [item("pass", "1"), item("pass", "2")],
        currentStatus,
      );
      expect(result).toBe(ControlStatus.COMPLIANT);
    },
  );

  it.each(startingStatuses)(
    "returns IN_PROGRESS when any item fails (from %s) — including downgrading COMPLIANT",
    (currentStatus) => {
      const result = deriveControlStatus(
        [item("pass", "1"), item("fail", "2")],
        currentStatus,
      );
      expect(result).toBe(ControlStatus.IN_PROGRESS);
    },
  );

  it.each(startingStatuses)(
    "returns null (no change) when there's an unknown and no fails (from %s)",
    (currentStatus) => {
      const result = deriveControlStatus(
        [item("pass", "1"), item("unknown", "2")],
        currentStatus,
      );
      expect(result).toBeNull();
    },
  );

  it("returns null for an all-unknown batch", () => {
    const result = deriveControlStatus(
      [item("unknown", "1"), item("unknown", "2")],
      ControlStatus.NOT_STARTED,
    );
    expect(result).toBeNull();
  });

  it("returns null for an empty evidence batch", () => {
    const result = deriveControlStatus([], ControlStatus.NOT_STARTED);
    expect(result).toBeNull();
  });

  it("never touches a NOT_APPLICABLE control, even with failing evidence", () => {
    const result = deriveControlStatus(
      [item("fail", "1")],
      ControlStatus.NOT_APPLICABLE,
    );
    expect(result).toBeNull();
  });

  it("never touches a NOT_APPLICABLE control, even with all-passing evidence", () => {
    const result = deriveControlStatus(
      [item("pass", "1")],
      ControlStatus.NOT_APPLICABLE,
    );
    expect(result).toBeNull();
  });

  it("a single failing item is enough to downgrade regardless of how many pass", () => {
    const result = deriveControlStatus(
      [item("pass", "1"), item("pass", "2"), item("pass", "3"), item("fail", "4")],
      ControlStatus.COMPLIANT,
    );
    expect(result).toBe(ControlStatus.IN_PROGRESS);
  });
});
