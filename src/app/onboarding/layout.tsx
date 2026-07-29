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
      <div className="flex min-h-screen items-center justify-center bg-dharma-bg">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-dharma-accent border-t-transparent" />
          <p className="mt-4 text-dharma-ink-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    // Onboarding is one of the few spacious surfaces (design system rule 4
    // reserves those for empty/onboarding states), so it keeps the brand
    // radial wash the marketing page uses. The previous amber/emerald
    // blur-3xl blobs are gone: they were the superseded saffron palette, and
    // blurred colour fields are the one depth cue the system rules out.
    <div className="min-h-screen bg-dharma-bg">
      <div className="relative z-10">{children}</div>
    </div>
  );
}
