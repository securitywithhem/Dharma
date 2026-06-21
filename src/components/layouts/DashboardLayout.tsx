import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopNav } from "@/components/TopNav";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <TopNav />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
