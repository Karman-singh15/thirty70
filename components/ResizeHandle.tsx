"use client";

import { useState } from "react";

interface ResizeHandleProps {
  onResize: (deltaX: number) => void;
}

// A thin draggable divider between two panes. Reports raw pointer deltaX
// as the user drags; callers decide how that maps to their own width state
// (which panel grows/shrinks, and its min/max clamp).
export function ResizeHandle({ onResize }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);

  function handlePointerDown(e: React.PointerEvent) {
    setDragging(true);
    let lastX = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handleMove(ev: PointerEvent) {
      const deltaX = ev.clientX - lastX;
      lastX = ev.clientX;
      onResize(deltaX);
    }

    function handleUp() {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="vertical"
      className="group relative w-2 shrink-0 cursor-col-resize touch-none select-none"
    >
      <div
        className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
          dragging ? "bg-emerald-500" : "bg-zinc-800 group-hover:bg-emerald-500/60"
        }`}
      />
    </div>
  );
}
