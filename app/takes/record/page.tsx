import { Suspense } from "react";
import RecordTakeClient from "./record-client";

export default function RecordTakePage() {
  return (
    <Suspense fallback={<RecordTakeLoading />}>
      <RecordTakeClient />
    </Suspense>
  );
}

function RecordTakeLoading() {
  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Record a Take</h1>
        <div className="px-3 py-2 rounded border border-zinc-400 bg-zinc-100 text-sm opacity-70">
          Loading…
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
        <div className="text-center">
          <div className="text-2xl font-semibold mb-2">Loading recorder…</div>
          <p className="text-sm text-zinc-600">Preparing camera + topic picker</p>
        </div>
      </div>
    </div>
  );
}