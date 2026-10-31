"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function Error({ error }: { error: unknown }) {
  return <ErrorScreen error={error} />;
}
