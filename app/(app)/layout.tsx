import { Suspense } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { MobileNav } from "@/components/dashboard/MobileNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // Column on a phone — the nav sits above the page — and a row from `md`,
    // where the sidebar becomes a rail beside it. The rail is a fixed 240px, so
    // without this it ate two thirds of a 390px screen.
    <div className="flex min-h-dvh flex-col bg-canvas md:flex-row">
      <MobileNav />
      <Suspense
        fallback={
          <div className="hidden h-dvh w-60 shrink-0 border-r border-line md:block" />
        }
      >
        <Sidebar />
      </Suspense>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
