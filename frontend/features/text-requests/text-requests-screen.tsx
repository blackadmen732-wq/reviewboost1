"use client";

import { useState } from "react";

import { TextRequestCompose } from "@/features/text-requests/text-request-compose";
import { TextRequestList } from "@/features/text-requests/text-request-list";

interface TextRequestsScreenProps {
  stands: { standId: string; label: string; token: string }[];
}

export function TextRequestsScreen({ stands }: TextRequestsScreenProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <TextRequestCompose
        stands={stands}
        segmentsRemaining={150}
        onSent={() => setRefreshKey((k) => k + 1)}
      />
      <TextRequestList refreshKey={refreshKey} />
    </div>
  );
}
