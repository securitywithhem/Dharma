"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc";
import { Loader2, ShieldCheck, Clock } from "lucide-react";

export default function AuditorLayout({ children }: { children: React.ReactNode }) {
  const { data: session, isLoading } = api.settings.session.useQuery();
  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    if (!session?.expires) return;
    
    const expiryDate = new Date(session.expires);
    
    const interval = setInterval(() => {
      const now = new Date();
      const diff = expiryDate.getTime() - now.getTime();
      
      if (diff <= 0) {
        setTimeLeft("Session expired");
        clearInterval(interval);
        window.location.reload();
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${hours}h ${minutes}m remaining`);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [session]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!session || session.role !== "VIEWER") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center px-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
        <p className="text-gray-500">Your auditor session is invalid or has expired.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Banner */}
      <div className="bg-indigo-600 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-2 font-medium">
          <ShieldCheck className="w-5 h-5" />
          <span>Dharma Auditor Portal — Read-Only Access</span>
        </div>
        <div className="flex items-center space-x-2 text-indigo-100 bg-indigo-700/50 px-3 py-1 rounded-full text-sm">
          <Clock className="w-4 h-4" />
          <span>{timeLeft || "Calculating..."}</span>
        </div>
      </div>
      
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
