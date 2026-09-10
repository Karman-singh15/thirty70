"use client";

// Clerk's avatar URLs, drawn the same way in the six places people appear.
// A component rather than six copies of the same <img> because each one needs
// the next/image escape hatch — these are remote URLs on a domain that isn't
// in the image config, and running them through the optimizer would mean
// configuring a host we don't control.

interface UserAvatarProps {
  src: string;
  name: string;
  className?: string;
  /** Draws the presence dot. Omit entirely where online-ness isn't shown. */
  online?: boolean;
}

export function UserAvatar({ src, name, className = "h-8 w-8", online }: UserAvatarProps) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full rounded-lg object-cover"
        />
      ) : (
        // A name always exists; an image doesn't. An initial keeps the row
        // the same height either way rather than collapsing it.
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center rounded-lg bg-elevated text-xs font-semibold uppercase text-muted"
        >
          {name.trim().charAt(0) || "?"}
        </span>
      )}
      {online !== undefined && (
        <span
          // The dot sits on the avatar, so it needs a ring in the surrounding
          // colour to stay legible against a dark-haired photo.
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${
            online ? "bg-success" : "bg-faint"
          }`}
          title={online ? "Online" : "Offline"}
        />
      )}
    </span>
  );
}
