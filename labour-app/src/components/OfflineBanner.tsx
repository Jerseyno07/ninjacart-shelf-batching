interface Props {
  isOffline: boolean;
  lastUpdatedAt: Date | null;
}

export function OfflineBanner({ isOffline, lastUpdatedAt }: Props) {
  if (!isOffline) return null;

  const timeLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "unknown";

  return (
    <div className="bg-amber-600 text-amber-50 text-sm px-4 py-2 text-center font-medium">
      Offline — showing data as of {timeLabel}
    </div>
  );
}
