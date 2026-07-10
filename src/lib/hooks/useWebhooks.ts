import { api } from '@/lib/trpc';

export function useWebhooks() {
  const utils = api.useUtils();

  const listQuery = api.webhook.list.useQuery();

  const createMutation = api.webhook.create.useMutation({
    onSuccess: () => void utils.webhook.list.invalidate(),
  });

  const updateMutation = api.webhook.update.useMutation({
    onSuccess: () => void utils.webhook.list.invalidate(),
  });

  const deleteMutation = api.webhook.delete.useMutation({
    onSuccess: () => void utils.webhook.list.invalidate(),
  });

  const testDeliverMutation = api.webhook.testDeliver.useMutation();

  const listDeliveriesQuery = (webhookId: string, enabled: boolean) =>
    api.webhook.listDeliveries.useQuery({ webhookId }, { enabled });

  return {
    listQuery,
    createMutation,
    updateMutation,
    deleteMutation,
    testDeliverMutation,
    listDeliveriesQuery,
  };
}
