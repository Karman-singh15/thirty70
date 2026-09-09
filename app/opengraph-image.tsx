import { ImageResponse } from "next/og";

// A link to this app shared anywhere — Discord, iMessage, a tweet — rendered
// as a bare title and URL, because nothing ever set og:image. This is the
// file convention for it: Next generates the tags and, since nothing here
// reads a request-time API, bakes the PNG at build time.
//
// No custom font is loaded on purpose. ImageResponse would need the .ttf
// bytes on disk to use Geist, and the repo has no assets/ directory —
// carrying a font file for one image isn't worth it when the fallback sets
// this type perfectly well at display size.

export const alt = "thirty70 — solve LeetCode problems together, in one room";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          // Warm paper, matching the app's default theme — the card should
          // look like the product, printed.
          //
          // Linear, not radial, and that's load-bearing: radial-gradient does
          // not survive satori (the renderer behind ImageResponse). It draws
          // the box but not the falloff to transparent, so a positioned radial
          // "glow" comes out as a hard rectangle with visible seams — tried
          // both a wide box and a square one. A full-canvas linear gradient
          // renders correctly and has no edge to seam at.
          backgroundImage:
            "linear-gradient(125deg, #fbfbf9 0%, #fbfbf9 55%, #f6f3ec 80%, #efe9dc 100%)",
          padding: "72px",
        }}
      >

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 52,
              height: 52,
              borderRadius: 12,
              background: "#1b1b19",
              color: "#fbfbf9",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            7
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, color: "#1b1b19" }}>
            thirty70
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              color: "#1b1b19",
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
            }}
          >
            Grind LeetCode
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              color: "#1b1b19",
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
            }}
          >
            in the same room.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 28,
              color: "#45453f",
              lineHeight: 1.4,
            }}
          >
            A shared editor, a turn timer, and someone watching the cursor move.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: "#8a4b12",
            }}
          />
          <div style={{ fontSize: 22, color: "#83837a" }}>
            Live rooms, synced cursors, voice and video
          </div>
        </div>
      </div>
    ),
    size
  );
}
