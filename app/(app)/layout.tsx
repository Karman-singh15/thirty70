import { Suspense } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Suspense fallback={<div className="h-screen w-60 shrink-0 border-r border-zinc-900" />}>
        <Sidebar />
      </Suspense>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
