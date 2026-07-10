import { api } from '@/lib/trpc';

export function useEvidenceMapping() {
  const utils = api.useUtils();

  const listByConnectorQuery = (connectorId: string) =>
    api.evidenceMapping.listByConnector.useQuery({ connectorId });

  const listByControlQuery = (controlId: string) =>
    api.evidenceMapping.listByControl.useQuery({ controlId });

  const createMutation = api.evidenceMapping.create.useMutation({
    onSuccess: () => {
      void utils.evidenceMapping.listByConnector.invalidate();
      void utils.evidenceMapping.listByControl.invalidate();
    },
  });

  const updateMutation = api.evidenceMapping.update.useMutation({
    onSuccess: () => {
      void utils.evidenceMapping.listByConnector.invalidate();
      void utils.evidenceMapping.listByControl.invalidate();
    },
  });

  const deleteMutation = api.evidenceMapping.delete.useMutation({
    onSuccess: () => {
      void utils.evidenceMapping.listByConnector.invalidate();
      void utils.evidenceMapping.listByControl.invalidate();
    },
  });

  const triggerNowMutation = api.evidenceMapping.triggerNow.useMutation();

  return {
    listByConnectorQuery,
    listByControlQuery,
    createMutation,
    updateMutation,
    deleteMutation,
    triggerNowMutation,
  };
}
