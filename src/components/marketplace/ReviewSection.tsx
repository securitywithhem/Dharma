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
      <h2 className="text-xl font-semibold text-dharma-ink mb-4">Reviews</h2>

      {/* Existing Reviews */}
      <div className="space-y-6 mb-6">
        {reviews && reviews.length > 0 ? (
          reviews.map((review) => (
            <div key={review.id} className="pb-6 border-b border-dharma-border last:border-0 last:pb-0">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-dharma-ink">
                    {review.title}
                  </p>
                  <p className="text-sm text-dharma-ink-secondary mt-1">
                    By {review.reviewer?.name || "Anonymous User"}
                  </p>
                </div>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < review.rating ? "fill-dharma-warning text-dharma-ink" : "fill-dharma-ink-muted text-dharma-ink-secondary"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className="text-dharma-ink text-sm mt-3">{review.content}</p>
            </div>
          ))
        ) : (
          <p className="text-dharma-ink-secondary text-sm">No reviews yet. Be the first to review this item!</p>
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
        <div className="space-y-4 border-t border-dharma-border pt-6">
          <div>
            <label className="block text-sm font-medium text-dharma-ink mb-2">
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
                      r <= rating ? "fill-dharma-warning text-dharma-ink" : "fill-dharma-ink-muted text-dharma-ink-secondary"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-dharma-ink mb-2">
              Title
            </label>
            <Input
              placeholder="Give your review a short title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dharma-ink mb-2">
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
