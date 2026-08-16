import { Loader2 } from "lucide-react";

// Drop-in replacement for whatever icon a button normally carries, so a
// control that's waiting on the server keeps its exact size and doesn't make
// the row jump.
export function Spinner({ className = "h-3 w-3" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />;
}
