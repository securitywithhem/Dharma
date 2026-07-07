import { api } from '@/lib/trpc';
import { useMemo } from 'react';

export function useEntitlements() {
  const { data, isLoading, error } = api.entitlement.getDashboard.useQuery();

  const isFeatureEnabled = (featureKey: string) => {
    if (!data) return false;
    const features = data.features as Record<string, boolean>;
    return features[featureKey] === true;
  };

  const usageStats = useMemo(() => {
    if (!data) return null;

    return {
      users: {
        current: data.currentUsage.users,
        limit: data.limits.users,
        percent: data.limits.users ? (data.currentUsage.users / data.limits.users) * 100 : 0,
        isNearLimit: data.limits.users ? data.currentUsage.users >= data.limits.users * 0.9 : false,
        isOverLimit: data.limits.users ? data.currentUsage.users >= data.limits.users : false,
      },
      frameworks: {
        current: data.currentUsage.frameworks,
        limit: data.limits.frameworks,
        percent: data.limits.frameworks ? (data.currentUsage.frameworks / data.limits.frameworks) * 100 : 0,
        isNearLimit: data.limits.frameworks ? data.currentUsage.frameworks >= data.limits.frameworks * 0.9 : false,
        isOverLimit: data.limits.frameworks ? data.currentUsage.frameworks >= data.limits.frameworks : false,
      },
      storage: {
        current: data.currentUsage.storageMb,
        limit: data.limits.storageMb,
        percent: data.limits.storageMb ? (data.currentUsage.storageMb / data.limits.storageMb) * 100 : 0,
        isNearLimit: data.limits.storageMb ? data.currentUsage.storageMb >= data.limits.storageMb * 0.9 : false,
        isOverLimit: data.limits.storageMb ? data.currentUsage.storageMb >= data.limits.storageMb : false,
      },
      planName: data.planName,
    };
  }, [data]);

  return {
    data,
    isLoading,
    error,
    isFeatureEnabled,
    usageStats,
  };
}
