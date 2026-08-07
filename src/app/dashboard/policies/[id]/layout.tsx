import type { Metadata } from "next";

// Metadata-only layout: page.tsx is a client component and so cannot
// export `metadata` itself. Title composes with the root layout's
// "%s | Dharma" template.
//
// Static rather than generateMetadata: resolving the policy title here would
// mean a second server-side fetch of a document the client component fetches
// anyway, on a route where the title is already visible in the page header.
export const metadata: Metadata = {
  title: "Policy",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
