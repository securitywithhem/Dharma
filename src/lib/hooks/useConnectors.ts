import { api } from '@/lib/trpc';

export function useConnectors() {
  const utils = api.useUtils();

  const listQuery = api.connector.list.useQuery();

  const createMutation = api.connector.create.useMutation({
    onSuccess: () => void utils.connector.list.invalidate(),
  });

  const updateMutation = api.connector.update.useMutation({
    onSuccess: () => void utils.connector.list.invalidate(),
  });

  const deleteMutation = api.connector.delete.useMutation({
    onSuccess: () => void utils.connector.list.invalidate(),
  });

  const testConnectionMutation = api.connector.testConnection.useMutation();
  const precheckConnectionMutation = api.connector.precheckConnection.useMutation();

  return {
    listQuery,
    createMutation,
    updateMutation,
    deleteMutation,
    testConnectionMutation,
    precheckConnectionMutation,
  };
}
