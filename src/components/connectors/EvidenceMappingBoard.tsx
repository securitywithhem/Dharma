"use client";

import React, { useState, useEffect } from "react";
import { ConnectorType } from "@prisma/client";
import { useEvidenceMapping } from "@/lib/hooks/useEvidenceMapping";
import { api } from "@/lib/trpc";
import { CollectNowButton } from "./CollectNowButton";

interface EvidenceMappingBoardProps {
  connectorId: string;
  connectorType: ConnectorType;
  connectorName: string;
  framework?: { id: string; name: string };
}

interface AvailableEvidenceType {
  id: string;
  name: string;
}

interface DraggedItem {
  evidenceTypeId: string;
  evidenceTypeName: string;
}

export function EvidenceMappingBoard({
  connectorId,
  connectorType,
  connectorName,
  framework,
}: EvidenceMappingBoardProps) {
  const [availableEvidenceTypes, setAvailableEvidenceTypes] = useState<
    AvailableEvidenceType[]
  >([]);
  const [loadingEvidenceTypes, setLoadingEvidenceTypes] = useState(true);
  const [draggedItem, setDraggedItem] = useState<DraggedItem | null>(null);
  const [undoStack, setUndoStack] = useState<
    { mappingId: string; timestamp: number }[]
  >([]);

  const { listByConnectorQuery, createMutation, deleteMutation } =
    useEvidenceMapping();

  const mappingsQuery = listByConnectorQuery(connectorId);
  const mappings = mappingsQuery.data || [];

  // Fetch available evidence types for this connector type
  const availableTypesQuery = api.connector.listAvailableEvidenceTypes.useQuery({
    type: connectorType,
  });

  useEffect(() => {
    if (availableTypesQuery.data) {
      const types = availableTypesQuery.data.map((t: any) => ({
        id: typeof t === "string" ? t : t.id,
        name: typeof t === "string" ? t : t.name || t.id,
      }));
      setAvailableEvidenceTypes(types);
      setLoadingEvidenceTypes(false);
    }
  }, [availableTypesQuery.data]);

  const handleDragStart = (evidenceType: AvailableEvidenceType) => {
    setDraggedItem({
      evidenceTypeId: evidenceType.id,
      evidenceTypeName: evidenceType.name,
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnControl = async (
    controlId: string,
    e: React.DragEvent
  ) => {
    e.preventDefault();
    if (!draggedItem) return;

    // Check if mapping already exists
    const exists = mappings.some(
      (m) =>
        m.controlId === controlId &&
        m.evidenceType === draggedItem.evidenceTypeId
    );

    if (exists) {
      alert("This evidence type is already mapped to this control");
      setDraggedItem(null);
      return;
    }

    try {
      await createMutation.mutateAsync({
        connectorId,
        controlId,
        evidenceType: draggedItem.evidenceTypeId,
      });
    } catch (error) {
      console.error("Failed to create evidence mapping:", error);
    }

    setDraggedItem(null);
  };

  const handleDeleteMapping = async (
    mappingId: string,
    controlId: string
  ) => {
    try {
      await deleteMutation.mutateAsync({ id: mappingId });

      // Add to undo stack
      setUndoStack((prev) => [
        ...prev,
        { mappingId, timestamp: Date.now() },
      ]);

      // Auto-clear from undo stack after 5 seconds
      setTimeout(() => {
        setUndoStack((prev) => prev.filter((item) => item.mappingId !== mappingId));
      }, 5000);

      // Show undo toast via console for now (Part 3 will add full toast UI)
      console.log(`Mapping deleted. Undo available for 5 seconds.`);
    } catch (error) {
      console.error("Failed to delete evidence mapping:", error);
    }
  };

  if (loadingEvidenceTypes) {
    return <div className="p-4 text-dharma-ink-secondary">Loading evidence types...</div>;
  }

  // Get controls from the framework or show placeholder
  const controls = framework ? (
    <div className="text-sm text-dharma-ink-secondary">
      No framework selected. Select a framework to map evidence.
    </div>
  ) : null;

  return (
    <div className="border rounded-lg bg-dharma-surface p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{connectorName}</h3>
        <p className="text-sm text-dharma-ink-secondary">
          Map evidence types to controls for automated collection
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Available Evidence Types */}
        <div className="border-r">
          <h4 className="font-medium mb-4">Available Evidence Types</h4>
          <div className="space-y-2">
            {availableEvidenceTypes.map((type) => (
              <div
                key={type.id}
                draggable
                onDragStart={() => handleDragStart(type)}
                className="p-3 bg-dharma-surface-hover border border-dharma-border rounded cursor-move hover:bg-dharma-surface-hover hover:border border-dharma-border transition-all"
              >
                <p className="text-sm font-medium">{type.name}</p>
                <p className="text-xs text-dharma-ink-secondary">{type.id}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Existing Mappings */}
        <div>
          <h4 className="font-medium mb-4">Mappings</h4>
          {mappings.length === 0 ? (
            <div className="p-4 bg-dharma-surface-hover border border-dashed rounded text-sm text-dharma-ink-secondary text-center">
              Drag evidence types here to create mappings
            </div>
          ) : (
            <div className="space-y-3">
              {mappings.map((mapping) => (
                <div
                  key={mapping.id}
                  className="p-3 bg-dharma-accent-tint border border-dharma-accent rounded"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-medium">{mapping.evidenceType}</p>
                      <p className="text-xs text-dharma-ink-secondary">
                        Schedule: {mapping.schedule}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        handleDeleteMapping(mapping.id, mapping.controlId)
                      }
                      className="text-xs px-2 py-1 text-dharma-danger-text hover:text-dharma-danger-text hover:bg-dharma-surface-hover rounded transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                  <CollectNowButton mappingId={mapping.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Undo Toast Preview */}
      {undoStack.length > 0 && (
        <div className="fixed bottom-4 right-4 bg-dharma-ink text-dharma-ink-inverse px-4 py-3 rounded-lg border border-dharma-border text-sm">
          Evidence mapping removed
          {/* Undo button will be added in Part 3 with deleteAuto endpoint */}
        </div>
      )}
    </div>
  );
}
