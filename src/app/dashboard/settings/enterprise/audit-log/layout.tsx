import type { Metadata } from "next";

// Metadata-only layout: page.tsx is a client component and so cannot
// export `metadata` itself. Title composes with the root layout's
// "%s | Dharma" template.
export const metadata: Metadata = {
  title: "Settings — Audit Log",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
