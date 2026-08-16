// A thin indeterminate bar across the top of the room while anything is
// waiting on the server. Per-button spinners say *what* is working; this says
// *that something* is, which is what makes a slow moment read as progress
// rather than as the app having ignored the click.
//
// The reveal is delayed by CSS rather than a timer: most requests now finish
// in well under that delay, and a bar that flashes on every interaction is
// worse than no bar at all. Fading out is immediate — only appearing waits.
export function TopProgressBar({ active }: { active: boolean }) {
  return (
    <div
      className={`pointer-events-none relative h-0.5 shrink-0 overflow-hidden transition-opacity duration-200 ${
        active ? "opacity-100 delay-200" : "opacity-0 delay-0"
      }`}
      role="progressbar"
      aria-hidden={!active}
    >
      <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
    </div>
  );
}
