import { Suspense } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <Suspense fallback={<div className="h-dvh w-60 shrink-0 border-r border-line" />}>
        <Sidebar />
      </Suspense>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
