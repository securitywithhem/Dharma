"use client";

import { api as trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";

import { useRouter } from "next/navigation";

export default function PublisherItemsPage() {
  const router = useRouter();
  const { data: items, isLoading } = trpc.marketplace.getPublisherItems.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Published Items</h1>
          <p className="text-dharma-ink-secondary">Manage your frameworks, templates, and connectors.</p>
        </div>
        <Button onClick={() => router.push("/dashboard/publisher/publish" as any)}>
          <Plus className="mr-2 h-4 w-4" />
          Publish New Item
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-dharma-ink-secondary" />
            </div>
          ) : !items?.length ? (
            <div className="text-center py-12">
              <p className="text-dharma-ink-secondary mb-4">You haven't published any items yet.</p>
              <Button variant="outline" onClick={() => router.push("/dashboard/publisher/publish" as any)}>
                Get Started
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Downloads</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell><Badge variant="outline">{item.type}</Badge></TableCell>
                    <TableCell>
                      {item.isPublic ? (
                        <Badge variant="default" className="bg-dharma-success-bg">Published</Badge>
                      ) : (
                        <Badge variant="secondary">Pending Review</Badge>
                      )}
                    </TableCell>
                    <TableCell>{item.downloads}</TableCell>
                    <TableCell>{item.ratings.toFixed(1)} ({item.reviewCount})</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/publisher/items/${item.id}/edit` as any)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
