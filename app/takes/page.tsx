import { Suspense } from "react";
import TakesClient from "./takes-client";

export default function TakesPage() {
  return (
    <Suspense fallback={<TakesLoading />}>
      <TakesClient />
    </Suspense>
  );
}

function TakesLoading() {
  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <div className="flex items-center gap-3 overflow-x-auto pb-3">
        <div className="px-4 py-2 rounded-full border border-zinc-400 bg-zinc-300 text-sm">
          Topics
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
        <div className="text-center">
          <div className="text-2xl font-semibold mb-2">Loading Takes…</div>
          <p className="text-sm text-zinc-600">Preparing your feed</p>
        </div>
      </div>
    </div>
  );
}