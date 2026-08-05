// Phase 3c — shared billing formatters.
//
// Currency is never hardcoded here. Razorpay India sells in INR, and Plan rows
// carry their own currency — a hardcoded "$" would misstate the price to a
// paying customer.

/** Plan.price is a major-unit amount (99, not 9900) paired with Plan.currency. */
export function formatPlanPrice(price: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    // Plans are whole amounts; showing "₹8,000.00" adds noise without meaning.
    minimumFractionDigits: 0,
    maximumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price || 0);
}

/**
 * Invoice amounts arrive in MINOR units from both providers (paise, cents),
 * which is why this divides and the plan formatter above does not.
 */
export function formatMinorUnits(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    typeof date === "string" ? new Date(date) : date,
  );
}
