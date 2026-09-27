import React, { useId } from "react";

export const AppleLogo = () => (
  <svg width="13" height="16" viewBox="0 0 814 1000" fill="currentColor" aria-hidden>
    <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4c-58.3-81.6-105.3-207.2-105.3-326.5 0-192.2 124.9-293.8 247.8-293.8 65.4 0 119.9 42.9 161 42.9 39.2 0 100.3-45.4 174.6-45.4 28.2 0 129.6 2.6 196.5 99.2zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.2 32.4-56.2 83.6-56.2 135.4 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 136.6-71.2z" />
  </svg>
);

export const CloseGlyph = () => (
  <svg viewBox="0 0 8 8" aria-hidden>
    <path d="M1.8 1.8l4.4 4.4M6.2 1.8L1.8 6.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export const MinimizeGlyph = () => (
  <svg viewBox="0 0 8 8" aria-hidden>
    <path d="M1.2 4h5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const ZoomGlyph = () => (
  <svg viewBox="0 0 8 8" aria-hidden>
    <path d="M1.9 6.1V2.9l3.2 3.2zM6.1 1.9v3.2L2.9 1.9z" fill="currentColor" />
  </svg>
);

export const ControlCenterIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <rect x="1.5" y="2.25" width="13" height="5" rx="2.5" />
    <circle cx="12" cy="4.75" r="1.3" fill="currentColor" stroke="none" />
    <rect x="1.5" y="8.75" width="13" height="5" rx="2.5" />
    <circle cx="4" cy="11.25" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * A Big Sur style folder. `badge` puts an image (a project logo) on the front
 * panel, like a custom folder icon in Finder.
 */
export const FolderGlyph = ({
  size = 64,
  badge,
  badgeFit = "cover",
}: {
  size?: number;
  badge?: string;
  badgeFit?: "cover" | "contain";
}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <span style={{ position: "relative", display: "block", width: size, height: size, flexShrink: 0 }}>
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden
        style={{ display: "block", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.28))" }}
      >
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4aa3f2" />
            <stop offset="1" stopColor="#2a86e0" />
          </linearGradient>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fcdfc" />
            <stop offset="1" stopColor="#5daef6" />
          </linearGradient>
        </defs>
        <path
          d="M4 13a4 4 0 0 1 4-4h14.3a4 4 0 0 1 2.9 1.2l3.1 3.3H56a4 4 0 0 1 4 4V53a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"
          fill={`url(#${id}b)`}
        />
        <rect x="4" y="19" width="56" height="38" rx="4" fill={`url(#${id}f)`} />
        <path d="M8 19.6h48" stroke="#c4e5ff" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
      </svg>
      {badge && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={badge}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: "33%",
            top: "43%",
            width: "34%",
            height: "34%",
            borderRadius: "50%",
            objectFit: badgeFit,
            background: "#fff",
            boxShadow: "0 0 0 1.5px rgba(255,255,255,0.9), 0 1px 3px rgba(0,40,90,0.35)",
            pointerEvents: "none",
          }}
        />
      )}
    </span>
  );
};
