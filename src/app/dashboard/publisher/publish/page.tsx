"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function PublishItemPage() {
  const router = useRouter();
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/publisher/items" as any)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publish New Item</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item Details</CardTitle>
          <CardDescription>Fill out the details to submit your item to the marketplace.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-dharma-ink-secondary text-sm text-center py-12">
            Publishing form placeholder. This form will capture item type, metadata, and files.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
