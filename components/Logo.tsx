// The app's mark: a frog hunched behind a laptop, drawn as pixel art.
//
// The whole sprite is a 36×21 pixel grid traced from the source artwork. It
// is stored here as one <path> per palette colour rather than ~750 <rect>
// elements: each path is a list of "M x y h w v h h -w z" subpaths, one per
// merged run of same-coloured pixels, which collapses the grid to 149
// rectangles across nine paths. That matters more than it looks — this
// component is rendered through satori at build time by
// app/opengraph-image.tsx, and satori walks every node.
//
// app/icon.svg is the same sprite hand-exported as a flat file, because the
// tab icon has to be an actual .svg for Next to treat it as one. It is a copy,
// so it does not track edits made here — regenerate it (and app/favicon.ico,
// rasterised from the same paths) if the frog ever changes.
//
// Coordinates are in *sprite* space (integers, 0..36 × 0..21), never scaled
// by hand, and the group is placed with a whole-number translate. Anything
// fractional here shows up as hairline seams between neighbouring pixels
// once a renderer starts anti-aliasing, so the grid stays on integers and
// the outer viewBox does all the scaling.
//
// Only the tile is themed; the frog's own palette is fixed. Unlike the
// abstract mark this replaced — line art that had to invert to stay visible —
// this is an illustration, and a green frog that turns cream in dark mode is
// a different frog. Inverting just its outline was tried and looks worse than
// leaving it: the sprite's outline is heavy enough that going light turns it
// into a halo around the art rather than a line inside it. Left dark, it
// simply melts into the dark tile and the frog reads as a clean silhouette,
// which is the better of the two.
//
// `bg` therefore defaults to var(--accent) — ink on paper, so dark in light
// mode and light in dark mode. The default is a CSS variable rather than a hex
// because every callsite but one is a live page that wants exactly that. The
// exception is app/opengraph-image.tsx, rendered through satori with no DOM
// and so no var() to resolve; it passes the light-mode literal, which is also
// the right tile for the card's paper background.
//
// The tab icon does not flip either, and deliberately goes the other way: it
// is fixed to the *light* tile. A favicon sits on browser chrome, which is
// usually dark and which the page cannot read, so the cream tile is the one
// that survives both.

const INK =
  "M12 0h4v1h-4zM19 0h5v1h-5zM11 1h1v1h-1zM16 1h3v1h-3zM24 1h1v1h-1zM10 2h1v4h-1zM18 2h1v1h-1zM25 2h1v3h-1zM26 4h1v1h-1zM12 5h1v1h-1zM22 5h1v1h-1zM27 5h1v2h-1zM9 6h1v3h-1zM14 6h7v1h-7zM28 7h1v2h-1zM4 8h5v1h-5zM10 8h7v1h-7zM3 9h1v3h-1zM17 9h1v1h-1zM29 9h1v5h-1zM18 10h1v6h-1zM24 10h1v1h-1zM28 10h1v3h-1zM30 10h3v1h-3zM4 11h1v1h-1zM33 11h1v5h-1zM2 12h1v3h-1zM5 12h1v1h-1zM20 12h4v1h-4zM6 13h1v1h-1zM19 13h1v5h-1zM27 13h1v1h-1zM4 14h2v1h-2zM20 14h1v1h-1zM25 14h2v1h-2zM28 14h1v2h-1zM3 15h1v1h-1zM5 15h1v6h-1zM22 15h1v1h-1zM24 15h2v1h-2zM4 16h1v2h-1zM20 16h2v2h-2zM23 16h2v2h-2zM27 16h1v1h-1zM32 16h1v2h-1zM1 17h3v1h-3zM22 17h1v2h-1zM25 17h2v1h-2zM30 17h2v1h-2zM33 17h2v1h-2zM0 18h1v3h-1zM6 18h13v1h-13zM20 18h1v1h-1zM25 18h1v1h-1zM27 18h1v2h-1zM35 18h1v3h-1zM2 19h1v2h-1zM28 19h3v1h-3zM33 19h1v2h-1zM1 20h1v1h-1zM3 20h2v1h-2zM6 20h21v1h-21zM31 20h2v1h-2zM34 20h1v1h-1z";

const GREEN =
  "M13 1h2v5h-2zM20 1h3v4h-3zM12 2h1v3h-1zM15 2h3v4h-3zM19 2h1v4h-1zM23 2h1v4h-1zM11 3h1v3h-1zM18 3h1v3h-1zM24 3h1v7h-1zM20 5h2v1h-2zM25 5h2v9h-2zM10 6h1v2h-1zM12 6h2v1h-2zM21 6h2v2h-2zM11 7h2v1h-2zM23 7h1v3h-1zM27 7h1v6h-1zM22 8h1v1h-1zM28 9h1v1h-1zM24 11h1v4h-1zM30 11h3v5h-3zM3 12h2v2h-2zM5 13h1v1h-1zM20 13h4v1h-4zM28 13h1v1h-1zM3 14h1v1h-1zM21 14h3v1h-3zM27 14h1v2h-1zM29 14h1v5h-1zM4 15h1v1h-1zM20 15h2v1h-2zM23 15h1v1h-1zM22 16h1v1h-1zM28 16h1v3h-1zM30 16h1v1h-1zM27 17h1v1h-1zM1 18h2v1h-2zM4 18h1v2h-1zM30 18h2v1h-2zM33 18h2v1h-2zM1 19h1v1h-1zM3 19h1v1h-1zM31 19h2v1h-2zM34 19h1v1h-1z";

const DEEP_GREEN =
  "M12 1h1v1h-1zM15 1h1v1h-1zM19 1h1v1h-1zM23 1h1v1h-1zM11 2h1v1h-1zM24 2h1v1h-1zM31 16h1v1h-1zM3 18h1v1h-1zM32 18h1v1h-1z";

const BELLY =
  "M13 7h8v1h-8zM17 8h5v1h-5zM18 9h5v1h-5zM19 10h5v2h-5zM19 12h1v1h-1zM26 15h1v2h-1zM25 16h1v1h-1z";

const BLUSH = "M11 6h1v1h-1zM23 6h1v1h-1z";

const LAPTOP =
  "M5 10h12v2h-12zM6 12h4v1h-4zM12 12h5v6h-5zM7 13h3v5h-3zM6 14h1v3h-1zM10 14h2v4h-2zM17 17h1v1h-1zM6 19h12v1h-12z";

const LAPTOP_SHADE =
  "M16 9h1v1h-1zM17 10h1v7h-1zM18 16h1v2h-1zM19 18h1v2h-1zM21 18h1v2h-1zM23 18h2v2h-2zM26 18h1v2h-1zM18 19h1v1h-1zM20 19h1v1h-1zM22 19h1v1h-1zM25 19h1v1h-1z";

const LID_EDGE = "M4 9h12v1h-12zM4 10h1v1h-1zM6 17h1v1h-1z";

const SCREEN = "M10 12h2v2h-2z";

interface LogoProps {
  size?: number;
  className?: string;
  /** The rounded tile the frog sits on. Ink on paper, so it flips with the theme. */
  bg?: string;
  /**
   * Swap the still frog for the typing loop while the pointer is over it.
   * Off by default: the animated branch needs a DOM (an <img>, a CSS class,
   * a :hover), none of which exist under satori.
   */
  animated?: boolean;
}

/* 36 wide inside a 40 tile leaves 2px of margin either side; 21 tall centres
   at 9.5, rounded down to 10 so the grid stays on integers. */
const frog = (
  <g transform="translate(2 10)">
    <path d={INK} fill="#24152e" />
    <path d={GREEN} fill="#68af57" />
    <path d={DEEP_GREEN} fill="#47895d" />
    <path d={BELLY} fill="#fbed99" />
    <path d={BLUSH} fill="#e37669" />
    <path d={LAPTOP} fill="#77747d" />
    <path d={LAPTOP_SHADE} fill="#524d59" />
    <path d={LID_EDGE} fill="#a5a2a9" />
    <path d={SCREEN} fill="#c8c9d1" />
  </g>
);

export function Logo({
  size = 28,
  className,
  bg = "var(--accent)",
  animated = false,
}: LogoProps) {
  if (!animated) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        className={className}
        role="img"
        aria-label="LeetDuel"
        shapeRendering="crispEdges"
      >
        <rect width="40" height="40" rx="9" fill={bg} />
        {frog}
      </svg>
    );
  }

  // The tile moves out of the SVG and onto the wrapper here, because the GIF
  // has to sit on it too — public/logo-hover.gif is transparent everywhere the
  // paper showed, so one tile serves both states and the swap is only ever the
  // frog. `overflow-hidden` plus the same 22.5% radius (9 of 40) keeps the GIF
  // inside the tile's corners.
  //
  // The GIF is a background rather than an <img> on purpose: it is decorative,
  // it never needs alt text, and as a background the browser can size it to the
  // box without the sprite ever landing on a half pixel.
  return (
    <span
      className={`logo-mark${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, background: bg }}
      role="img"
      aria-label="LeetDuel"
    >
      <svg viewBox="0 0 40 40" shapeRendering="crispEdges" aria-hidden="true">
        {frog}
      </svg>
      <span className="logo-mark-loop" aria-hidden="true" />
    </span>
  );
}
