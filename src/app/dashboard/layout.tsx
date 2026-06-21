import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { ReactNode } from "react";
import { DashboardLayout } from "@/components/layouts/DashboardLayout";
import { authOptions } from "@/server/auth";

export default async function DashboardShell({
  children
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/dashboard");
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
