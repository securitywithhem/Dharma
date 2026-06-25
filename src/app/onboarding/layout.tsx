'use client';

import React from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // Redirect to login if not authenticated
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 dark:from-stone-900 dark:to-stone-800">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-stone-600 dark:text-stone-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 dark:from-stone-900 dark:to-stone-800">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 right-0 w-96 h-96 bg-amber-200 dark:bg-amber-900 rounded-full opacity-20 blur-3xl" />
        <div className="absolute -bottom-1/2 left-0 w-96 h-96 bg-emerald-200 dark:bg-emerald-900 rounded-full opacity-20 blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
