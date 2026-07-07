"use client";

import React, { useState } from "react";
import { api as trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Star, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "sonner"; // Assuming sonner is used for toasts, or we can just use native alert

interface ReviewSectionProps {
  itemId: string;
  reviews: any[];
}

export function ReviewSection({ itemId, reviews }: ReviewSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const utils = trpc.useUtils();

  const addReview = trpc.marketplace.addReview.useMutation({
    onSuccess: () => {
      // toast.success("Review added successfully!");
      alert("Review added successfully!");
      setShowForm(false);
      setTitle("");
      setContent("");
      setRating(5);
      // Invalidate the query to refetch item and reviews
      utils.marketplace.getItem.invalidate({ identifier: itemId });
    },
    onError: (error) => {
      alert(`Failed to post review: ${error.message}`);
    }
  });

  return (
    <Card className="p-6 mt-8">
      <h2 className="text-xl font-semibold text-foreground mb-4">Reviews</h2>

      {/* Existing Reviews */}
      <div className="space-y-6 mb-6">
        {reviews && reviews.length > 0 ? (
          reviews.map((review) => (
            <div key={review.id} className="pb-6 border-b border-border last:border-0 last:pb-0">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-foreground">
                    {review.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    By {review.reviewer?.name || "Anonymous User"}
                  </p>
                </div>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < review.rating ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className="text-foreground text-sm mt-3">{review.content}</p>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">No reviews yet. Be the first to review this item!</p>
        )}
      </div>

      {/* Review Form */}
      {!showForm ? (
        <Button
          onClick={() => setShowForm(true)}
          variant="outline"
          className="w-full"
        >
          Write a Review
        </Button>
      ) : (
        <div className="space-y-4 border-t border-border pt-6">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Rating
            </label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  onClick={() => setRating(r)}
                  className="transition-transform hover:scale-110 focus:outline-none"
                >
                  <Star
                    className={`h-6 w-6 ${
                      r <= rating ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Title
            </label>
            <Input
              placeholder="Give your review a short title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Review
            </label>
            <Textarea
              placeholder="What did you think of this item?"
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() =>
                addReview.mutate({
                  marketplaceItemId: itemId,
                  rating,
                  title,
                  content,
                })
              }
              disabled={addReview.isPending || !title || !content}
            >
              {addReview.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post Review
            </Button>
            <Button
              onClick={() => setShowForm(false)}
              variant="outline"
              disabled={addReview.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
