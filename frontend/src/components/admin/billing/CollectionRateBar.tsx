"use client";

import { collectionRateBarColor } from "@/components/admin/billing/billingTypes";

type CollectionRateBarProps = {
  rate: number;
  showLabel?: boolean;
  className?: string;
};

export default function CollectionRateBar({
  rate,
  showLabel = true,
  className,
}: CollectionRateBarProps) {
  const clamped = Math.min(100, Math.max(0, rate));

  return (
    <div className={className}>
      {showLabel ? (
        <span className="font-medium text-gray-900">{rate}%</span>
      ) : null}
      <div
        className={`${showLabel ? "mt-1" : ""} h-1.5 w-full overflow-hidden rounded-full bg-gray-100`}
      >
        <div
          className={`h-full rounded-full ${collectionRateBarColor(rate)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
