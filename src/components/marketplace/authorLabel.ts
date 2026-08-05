/**
 * How a marketplace item's author is displayed.
 *
 * `MarketplaceItem.authorId` became nullable so that deleting an organization
 * no longer fails (see the migration
 * 20260805170000_marketplace_author_reviewer_setnull_on_user_delete). That
 * introduced a state the previous `item.author?.name || "Dharma"` could not
 * express: an item whose author's account is gone would have been attributed
 * to Dharma itself, claiming vendor authorship of community content.
 *
 * The three cases are genuinely different and must not collapse:
 *   - `undefined` — the caller did not select the relation. Keep the previous
 *     "Dharma" default, which is what official/first-party listings render.
 *   - `null`      — the author's account was removed. Say so.
 *   - present     — show the name; a user with no name set is "Unnamed user",
 *     which is a display gap, not a removed account.
 */
export function marketplaceAuthorLabel(
  author: { name: string | null } | null | undefined,
): string {
  if (author === undefined) return "Dharma";
  if (author === null) return "Removed account";
  return author.name ?? "Unnamed user";
}
