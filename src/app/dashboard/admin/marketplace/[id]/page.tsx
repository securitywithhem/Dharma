"use client";

import { api as trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";

export default function AdminReviewItemPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: item, isLoading } = trpc.marketplace.getItem.useQuery({ identifier: params.id });
  const approveMutation = trpc.marketplace.approveItem.useMutation({
    onSuccess: () => {
      router.push("/dashboard/admin/marketplace" as any);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!item) {
    return <div className="text-center py-12">Item not found</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Item</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-xl">{item.name}</CardTitle>
              <CardDescription>By {item.author.name || item.author.email}</CardDescription>
            </div>
            <Badge>{item.type}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="font-semibold mb-2">Description</h3>
            <p className="text-sm whitespace-pre-wrap">{item.description}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold mb-2">Category</h3>
              <p className="text-sm">{item.category}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Tags</h3>
              <div className="flex gap-2 flex-wrap">
                {item.tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-6 border-t">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button 
              disabled={approveMutation.isPending || item.isPublic}
              onClick={() => approveMutation.mutate({ id: item.id })}
            >
              {approveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {item.isPublic ? "Already Approved" : "Approve & Publish"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
