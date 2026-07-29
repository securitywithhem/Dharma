export default function DashboardLoading() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-32 animate-pulse rounded-xl border border-dharma-border bg-dharma-surface-hover"
        />
      ))}
    </div>
  );
}
