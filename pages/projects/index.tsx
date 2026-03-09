import { Sidebar } from "../../components/Sidebar";
import { Box, Flex, Text, VStack, HStack, useBreakpointValue } from "@chakra-ui/react";
import React, { useState, useEffect, useRef, useCallback } from "react";
import Draggable from "react-draggable";
import { Navbar } from "../../components/Navbar";
import { Meta } from "../../components/Meta";
import { useColorMode } from "../../components/ui/color-mode";
import { useRouter } from "next/router";
import { DragonBotPage } from "./dragonbot";
import { CahillClubPage } from "./cahillclub";
import { NowPlaying } from "../../components/NowPlaying";
import useSWR from "swr";
import fetcher from "../../lib/fetcher";

/* ─── Types ─── */

interface Project {
  id: string;
  name: string;
  imageSrc: string;
  position: { x: number; y: number };
  href: string;
}

/* ─── Data ─── */

const PROJECTS: Project[] = [
  {
    id: "cahillclub",
    name: "Cahill Club",
    imageSrc: "/cahillclub_folder.png",
    position: { x: 20, y: 20 },
    href: "/projects/cahillclub",
  },
  {
    id: "dragonbot",
    name: "DragonBot",
    imageSrc: "/dragonbot_folder.png",
    position: { x: 65, y: 50 },
    href: "/projects/dragonbot",
  },
];

/* ─── Page content map ─── */

const PAGE_COMPONENTS: Record<string, React.ComponentType<{ embedded?: boolean }>> = {
  dragonbot: DragonBotPage,
  cahillclub: CahillClubPage,
};

/* ─── Neofetch Data ─── */

const NEOFETCH_LOGO = [
  "                    'c.",
  "                 ,xNMM.",
  "               .OMMMMo",
  "               OMMM0,",
  "     .;loddo:' loollodol;.",
  "   cKMMMMMMMMMMNWMMMMMMMM0:",
  " .KMMMMMMMMMMMMMMMMMMMMMMMWd.",
  " XMMMMMMMMMMMMMMMMMMMMMMMMX.",
  ";MMMMMMMMMMMMMMMMMMMMMMMM:",
  ":MMMMMMMMMMMMMMMMMMMMMMMM:",
  ".MMMMMMMMMMMMMMMMMMMMMMMMX.",
  " kMMMMMMMMMMMMMMMMMMMMMMMMWd.",
  " .XMMMMMMMMMMMMMMMMMMMMMMMMk",
  "  .XMMMMMMMMMMMMMMMMMMMMK.",
  "    kMMMMMMMMMMMMMMMMMMd",
  "     ;KMMMMMMMWXXWMMMMMMMk.",
  "       .cooc,.    .,coo:.",
];

const NEOFETCH_INFO: { label: string | null; value: string; color?: string }[] = [
  { label: null, value: "Kevin@MacBookPro.lan", color: "#3a71a4" },
  { label: null, value: "----------------------", color: "#3a71a4" },
  { label: "OS", value: "macOS 26.3 25D125 arm64" },
  { label: "Host", value: "MacBookPro18,4" },
  { label: "Kernel", value: "25.3.0" },
  { label: "Uptime", value: "" },
  { label: "Shell", value: "zsh 5.9" },
  { label: "Resolution", value: "1800x1169" },
  { label: "DE", value: "Aqua" },
  { label: "WM", value: "Rectangle" },
  { label: "Terminal", value: "Apple_Terminal" },
  { label: "Terminal Font", value: "SFMono-Regular" },
  { label: "CPU", value: "Apple M1 Max" },
  { label: "GPU", value: "Apple M1 Max" },
];

const NEOFETCH_COLORS = ["#374953", "#f66605", "#2f5d86", "#d2a700", "#007e8d", "#c000c0", "#247b68", "#cfd7db"];

// Apple rainbow colors per logo line (matching real neofetch macOS)
const LOGO_LINE_COLORS = [
  "#61BA46", "#61BA46", "#61BA46", "#61BA46",  // Green
  "#FDB827", "#FDB827", "#FDB827",              // Yellow
  "#F5821F", "#F5821F",                          // Orange
  "#E03A3E", "#E03A3E", "#E03A3E",              // Red
  "#963D97", "#963D97",                          // Purple
  "#009DDC", "#009DDC", "#009DDC",              // Blue
];

/* ─── Apple Logo ─── */

const AppleLogo = () => (
  <svg width="12" height="15" viewBox="0 0 814 1000" fill="currentColor">
    <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4c-58.3-81.6-105.3-207.2-105.3-326.5 0-192.2 124.9-293.8 247.8-293.8 65.4 0 119.9 42.9 161 42.9 39.2 0 100.3-45.4 174.6-45.4 28.2 0 129.6 2.6 196.5 99.2zM554.1 159.4c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.2 32.4-56.2 83.6-56.2 135.4 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 136.6-71.2z" />
  </svg>
);

/* ─── Spotify Visualizer ─── */

const VISUALIZER_BARS = 24;
const SpotifyVisualizer = ({ isPlaying }: { isPlaying: boolean }) => {
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: VISUALIZER_BARS }, () => 0.15)
  );

  useEffect(() => {
    if (!isPlaying) {
      setBars(Array.from({ length: VISUALIZER_BARS }, () => 0.15));
      return;
    }
    const interval = setInterval(() => {
      setBars(prev => prev.map((_, i) => {
        // Create a wave-like pattern with some randomness
        const base = Math.sin(Date.now() / 400 + i * 0.5) * 0.3 + 0.5;
        const random = Math.random() * 0.3;
        return Math.max(0.1, Math.min(1, base + random));
      }));
    }, 120);
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-end",
      gap: 2,
      height: 40,
      padding: "0 4px",
    }}>
      {bars.map((h, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${h * 100}%`,
            background: `linear-gradient(to top, #1DB954, #1ed760)`,
            borderRadius: 1,
            transition: isPlaying ? "height 0.1s ease" : "height 0.5s ease",
            opacity: isPlaying ? 0.85 : 0.3,
          }}
        />
      ))}
    </div>
  );
};

const SpotifyApp = () => {
  const { data } = useSWR<{ isPlaying?: boolean; songUrl?: string }>("/api/nowplaying", fetcher, {
    refreshInterval: 15000,
    dedupingInterval: 1000,
  });
  const isPlaying = !!(data?.isPlaying && data?.songUrl);

  return (
    <div style={{ padding: "12px 16px" }}>
      <NowPlaying />
      <SpotifyVisualizer isPlaying={isPlaying} />
    </div>
  );
};

/* ─── FolderIcon (draggable) ─── */

const FolderIcon = ({
  project,
  selected,
  isDark,
  onClick,
  onDoubleClick,
  containerRef,
}: {
  project: Project;
  selected: boolean;
  isDark: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [hover, setHover] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [lastTap, setLastTap] = useState(0);
  const nodeRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!containerRef || !containerRef.current) return;
    const w = containerRef.current.offsetWidth;
    const h = containerRef.current.offsetHeight;
    setPosition({
      x: (w * project.position.x) / 100,
      y: (h * project.position.y) / 100,
    });
  }, [containerRef, project.position]);

  useEffect(() => {
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTap < 300 && now - lastTap > 0) {
      onDoubleClick();
    }
    setLastTap(now);
  };

  return (
    <Draggable
      position={position}
      onStop={(_e, data) => setPosition({ x: data.x, y: data.y })}
      bounds="parent"
      nodeRef={nodeRef}
    >
      <div
        ref={nodeRef}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
        onTouchStart={handleTouchStart}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 10,
          borderRadius: 6,
          cursor: "grab",
          border: selected
            ? "1.5px dashed rgba(59,130,246,0.5)"
            : "1.5px dashed transparent",
          background:
            selected || hover ? "rgba(59,130,246,0.08)" : "transparent",
          transition: "background 0.15s, border-color 0.15s",
          userSelect: "none",
          color: isDark ? "#fafafa" : "#09090b",
          touchAction: "none",
        }}
      >
        <img
          src={project.imageSrc}
          alt={project.name}
          style={{ width: 64, height: 64, objectFit: "contain", pointerEvents: "none" }}
          draggable={false}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            textAlign: "center",
            maxWidth: 80,
            lineHeight: 1.3,
            fontFamily: "monospace",
            textShadow: "0 1px 2px rgba(0,0,0,0.06)",
            textDecoration: hover ? "underline" : "none",
          }}
        >
          {project.name}
        </span>
      </div>
    </Draggable>
  );
};

/* ─── Finder Icon (for dock) ─── */

const FinderIcon = ({ size = 48 }: { size?: number }) => (
  <img
    src="/finder-dock.png"
    alt="Finder"
    width={size}
    height={size}
    style={{ objectFit: "contain" }}
    draggable={false}
  />
);

/* ─── Dock styles (injected once) ─── */

const dockStyleId = "dock-styles";
const ensureDockStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(dockStyleId)) return;
  const style = document.createElement("style");
  style.id = dockStyleId;
  style.textContent = `
    @keyframes genie-minimize {
      0% { transform: scale(1) translate(0, 0); opacity: 1; }
      50% { transform: scale(0.4) translate(calc(var(--genie-x, 0) * 0.5), calc(var(--genie-y, 0) * 0.5)); opacity: 0.7; }
      100% { transform: scale(0.05) translate(var(--genie-x, 0), var(--genie-y, 0)) scaleX(0.3); opacity: 0; }
    }
    @keyframes genie-restore {
      0% { transform: scale(0.05) translate(var(--genie-x, 0), var(--genie-y, 0)) scaleX(0.3); opacity: 0; }
      50% { transform: scale(0.5) translate(calc(var(--genie-x, 0) * 0.4), calc(var(--genie-y, 0) * 0.4)); opacity: 0.8; }
      100% { transform: scale(1) translate(0, 0); opacity: 1; }
    }
    .dock-item {
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), margin 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .window-genie-minimize {
      animation: genie-minimize 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      transform-origin: bottom center;
    }
    .window-genie-restore {
      animation: genie-restore 0.4s cubic-bezier(0, 0, 0.2, 1) forwards;
      transform-origin: bottom center;
    }
    @keyframes terminal-blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
};

/* ─── DockItem ─── */

const DockItem = ({
  children,
  label,
  onClick,
  isDark,
  mouseX,
  itemRef,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  isDark: boolean;
  mouseX: number | null;
  itemRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (mouseX === null || !itemRef.current) {
      setScale(1);
      return;
    }
    const rect = itemRef.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const dist = Math.abs(mouseX - center);
    const maxDist = 120;
    const maxScale = 1.6;
    const newScale = dist > maxDist ? 1 : 1 + (maxScale - 1) * (1 - dist / maxDist);
    setScale(newScale);
  }, [mouseX, itemRef]);

  return (
    <div
      ref={itemRef}
      className="dock-item"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 2px",
        cursor: onClick ? "pointer" : "default",
        transform: `scale(${scale})`,
        marginBottom: (scale - 1) * 24,
        marginLeft: (scale - 1) * 10,
        marginRight: (scale - 1) * 10,
        transformOrigin: "bottom center",
      }}
    >
      {children}
      <span style={{ fontSize: 9, opacity: 0.6, marginTop: 2, color: isDark ? "#fff" : "#000" }}>
        {label}
      </span>
    </div>
  );
};

/* ─── Dock ─── */

const DockAppIcon = ({ src, alt, running, isDark }: { src: string; alt: string; running: boolean; isDark: boolean }) => (
  <div style={{ position: "relative" }}>
    <img src={src} alt={alt} width={56} height={56} style={{ objectFit: "contain" }} draggable={false} />
    {running && (
      <div style={{ position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: isDark ? "#fff" : "#000", opacity: 0.5 }} />
    )}
  </div>
);

const MiniWindowPreview = ({ name, icon, isDark, bg }: { name: string; icon: string; isDark: boolean; bg?: string }) => (
  <div style={{
    width: 64, height: 48, borderRadius: 4, overflow: "hidden",
    background: bg || (isDark ? "#1c1c1e" : "#fff"),
    border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}`,
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column",
  }}>
    <div style={{ height: 8, background: isDark ? "#2c2c2e" : "#f5f5f5", display: "flex", alignItems: "center", padding: "0 3px", gap: 2, flexShrink: 0 }}>
      <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#ff5f57" }} />
      <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#febc2e" }} />
      <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#28c840" }} />
    </div>
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 2 }}>
      <img src={icon} alt={name} style={{ width: 24, height: 24, objectFit: "contain", opacity: 0.8 }} draggable={false} />
    </div>
  </div>
);

const Dock = ({
  isDark,
  minimizedWindows,
  onRestoreWindow,
  onOpenApp,
  runningApps,
  minimizedApps,
  onRestoreApp,
}: {
  isDark: boolean;
  minimizedWindows: (Project & { previewHtml?: string })[];
  onRestoreWindow: (id: string) => void;
  onOpenApp: (appId: string) => void;
  runningApps: string[];
  minimizedApps: { id: string; name: string; icon: string }[];
  onRestoreApp: (appId: string) => void;
}) => {
  const dockBg = isDark ? "rgba(30,30,30,0.65)" : "rgba(240,240,240,0.65)";
  const dockBorder = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)";
  const [mouseX, setMouseX] = useState<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const finderRef = useRef<HTMLDivElement>(null);
  const spotifyRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());

  useEffect(() => { ensureDockStyles(); }, []);

  const getItemRef = (id: string) => {
    if (!itemRefs.current.has(id)) {
      itemRefs.current.set(id, { current: null });
    }
    return itemRefs.current.get(id)!;
  };

  const hasMinimized = minimizedWindows.length > 0 || minimizedApps.length > 0;

  return (
    <div
      ref={dockRef}
      data-dock
      onMouseMove={(e) => setMouseX(e.clientX)}
      onMouseLeave={() => setMouseX(null)}
      style={{
        position: "absolute",
        bottom: 6,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        padding: "6px 14px",
        borderRadius: 20,
        background: dockBg,
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: `1px solid ${dockBorder}`,
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
        zIndex: 200,
      }}
    >
      <DockItem label="Finder" isDark={isDark} mouseX={mouseX} itemRef={finderRef}>
        <DockAppIcon src="/finder-dock.png" alt="Finder" running={runningApps.includes("finder")} isDark={isDark} />
      </DockItem>

      <DockItem label="Spotify" isDark={isDark} mouseX={mouseX} itemRef={spotifyRef} onClick={() => onOpenApp("spotify")}>
        <DockAppIcon src="/spotify-dock.png" alt="Spotify" running={runningApps.includes("spotify")} isDark={isDark} />
      </DockItem>

      <DockItem label="Terminal" isDark={isDark} mouseX={mouseX} itemRef={terminalRef} onClick={() => onOpenApp("terminal")}>
        <DockAppIcon src="/terminal-dock.png" alt="Terminal" running={runningApps.includes("terminal")} isDark={isDark} />
      </DockItem>

      {hasMinimized && (
        <div style={{ width: 1, height: 48, background: dockBorder, marginLeft: 6, marginRight: 6, alignSelf: "center", flexShrink: 0 }} />
      )}

      {minimizedWindows.map((w) => (
        <DockItem key={w.id} label={w.name} onClick={() => onRestoreWindow(w.id)} isDark={isDark} mouseX={mouseX} itemRef={getItemRef(w.id)}>
          <MiniWindowPreview name={w.name} icon={w.imageSrc} isDark={isDark} />
        </DockItem>
      ))}

      {minimizedApps.map((app) => (
        <DockItem key={app.id} label={app.name} onClick={() => onRestoreApp(app.id)} isDark={isDark} mouseX={mouseX} itemRef={getItemRef(`app-${app.id}`)}>
          <MiniWindowPreview name={app.name} icon={app.icon} isDark={isDark} bg={app.id === "terminal" ? "#141920" : undefined} />
        </DockItem>
      ))}
    </div>
  );
};

/* ─── FinderWindow ─── */

const FinderWindow = ({
  project,
  isDark,
  zIndex,
  onClose,
  onFocus,
  onExpand,
  onMinimize,
  animatingState,
}: {
  project: Project;
  isDark: boolean;
  zIndex: number;
  onClose: () => void;
  onFocus: () => void;
  onExpand: () => void;
  onMinimize: () => void;
  animatingState?: { type: "minimize" | "restore"; gx: number; gy: number } | null;
}) => {
  const [pos, setPos] = useState({ x: 80, y: 60 });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tlHover, setTlHover] = useState(false);

  const windowBg = isDark ? "#1c1c1e" : "#ffffff";
  const windowBar = isDark ? "#2c2c2e" : "#f5f5f5";
  const windowBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)";
  const textSecondary = isDark ? "#a1a1aa" : "#71717a";
  const border = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const genieClass = animatingState?.type === "minimize" ? "window-genie-minimize"
    : animatingState?.type === "restore" ? "window-genie-restore" : "";

  const handleMouseDown = (e: React.MouseEvent) => {
    onFocus();
    setDragging(true);
    setOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) =>
      setPos({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    const up = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging, offset]);

  const PageComponent = PAGE_COMPONENTS[project.id];

  return (
    <div
      className={genieClass}
      data-window-id={project.id}
      onClick={onFocus}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: 680,
        maxWidth: "calc(100% - 40px)",
        height: "75vh",
        maxHeight: "calc(100% - 80px)",
        borderRadius: 8,
        overflow: "hidden",
        zIndex,
        background: windowBg,
        border: `1px solid ${windowBorder}`,
        boxShadow:
          "0 12px 40px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(0,0,0,0.05)",
        display: "flex",
        flexDirection: "column",
        ["--genie-x" as string]: `${animatingState?.gx ?? 0}px`,
        ["--genie-y" as string]: `${animatingState?.gy ?? 0}px`,
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          height: 36,
          flexShrink: 0,
          background: windowBar,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: `1px solid ${border}`,
          cursor: dragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        {/* Traffic lights */}
        <div
          style={{ display: "flex", gap: 7 }}
          onMouseEnter={() => setTlHover(true)}
          onMouseLeave={() => setTlHover(false)}
        >
          {/* Close */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#ff5f57",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              fontWeight: 700,
              color: tlHover ? "rgba(0,0,0,0.5)" : "transparent",
              lineHeight: 1,
            }}
          >
            ✕
          </div>
          {/* Minimize */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#febc2e",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: tlHover ? "rgba(0,0,0,0.5)" : "transparent",
              lineHeight: 1,
            }}
          >
            −
          </div>
          {/* Expand / Full Screen */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#28c840",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 7,
              fontWeight: 700,
              color: tlHover ? "rgba(0,0,0,0.5)" : "transparent",
              lineHeight: 1,
            }}
          >
            ⤢
          </div>
        </div>

        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 12,
            fontWeight: 500,
            color: textSecondary,
          }}
        >
          {project.name}
        </span>
      </div>

      {/* Page content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {PageComponent && <PageComponent embedded />}
      </div>
    </div>
  );
};

/* ─── AppWindow (generic window chrome) ─── */

const AppWindow = ({
  appId,
  title,
  isDark,
  zIndex,
  onClose,
  onFocus,
  onMinimize,
  animatingState,
  width = 400,
  height = "60vh" as number | string,
  initialPos = { x: 120, y: 80 },
  windowBgOverride,
  barBgOverride,
  children,
}: {
  appId: string;
  title: string;
  isDark: boolean;
  zIndex: number;
  onClose: () => void;
  onFocus: () => void;
  onMinimize: () => void;
  animatingState?: { type: "minimize" | "restore"; gx: number; gy: number } | null;
  width?: number;
  height?: number | string;
  initialPos?: { x: number; y: number };
  windowBgOverride?: string;
  barBgOverride?: string;
  children: React.ReactNode;
}) => {
  const [pos, setPos] = useState(initialPos);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tlHover, setTlHover] = useState(false);

  const windowBg = windowBgOverride || (isDark ? "#1c1c1e" : "#ffffff");
  const windowBar = barBgOverride || (isDark ? "#2c2c2e" : "#f5f5f5");
  const windowBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)";
  const textSecondary = isDark ? "#a1a1aa" : "#71717a";
  const border = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const genieClass = animatingState?.type === "minimize" ? "window-genie-minimize"
    : animatingState?.type === "restore" ? "window-genie-restore" : "";

  const handleMouseDown = (e: React.MouseEvent) => {
    onFocus();
    setDragging(true);
    setOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => setPos({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    const up = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [dragging, offset]);

  return (
    <div
      className={genieClass}
      data-window-id={appId}
      onClick={onFocus}
      style={{
        position: "absolute", left: pos.x, top: pos.y,
        width, maxWidth: "calc(100% - 40px)",
        height, maxHeight: "calc(100% - 80px)",
        borderRadius: 8, overflow: "hidden", zIndex,
        background: windowBg,
        border: `1px solid ${windowBorder}`,
        boxShadow: "0 12px 40px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(0,0,0,0.05)",
        display: "flex", flexDirection: "column",
        ["--genie-x" as string]: `${animatingState?.gx ?? 0}px`,
        ["--genie-y" as string]: `${animatingState?.gy ?? 0}px`,
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        style={{
          height: 36, flexShrink: 0, background: windowBar,
          display: "flex", alignItems: "center", padding: "0 12px",
          borderBottom: `1px solid ${border}`,
          cursor: dragging ? "grabbing" : "grab", userSelect: "none",
        }}
      >
        <div style={{ display: "flex", gap: 7 }} onMouseEnter={() => setTlHover(true)} onMouseLeave={() => setTlHover(false)}>
          <div onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: tlHover ? "rgba(0,0,0,0.5)" : "transparent", lineHeight: 1 }}>✕</div>
          <div onClick={(e) => { e.stopPropagation(); onMinimize(); }} style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: tlHover ? "rgba(0,0,0,0.5)" : "transparent", lineHeight: 1 }}>−</div>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <span style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 500, color: textSecondary }}>{title}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
    </div>
  );
};

/* ─── Terminal Content (neofetch) ─── */

const TerminalContent = () => {
  const [visibleLines, setVisibleLines] = useState(0);
  const [randomMem] = useState(() => 4000 + Math.floor(Math.random() * 8000));

  // Calculate uptime from birthday (May 27, 1999)
  const now = new Date();
  const birthday = new Date(1999, 4, 27); // Month is 0-indexed
  const diffMs = now.getTime() - birthday.getTime();
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(totalDays / 365);
  const remainingDays = totalDays - years * 365;
  const hours = now.getHours();
  const mins = now.getMinutes();
  const uptimeStr = `${years} years, ${remainingDays} days, ${hours} hours, ${mins} mins`;

  const infoWithDynamic = NEOFETCH_INFO.map(item =>
    item.label === "Uptime" ? { ...item, value: uptimeStr } : item
  );
  const infoWithMemory = [...infoWithDynamic, { label: "Memory", value: `${randomMem}MiB / 32768MiB` }];
  const totalLines = Math.max(NEOFETCH_LOGO.length, infoWithMemory.length);

  // Aritim Dark colors
  const bg = "#141920";
  const text = "#d1d7db";
  const labelColor = "#2f5d86"; // ANSI green (used for neofetch distro labels)
  const boldColor = "#3a71a4"; // bold text color
  const cursorColor = "#cfb14a";

  useEffect(() => {
    const startTimer = setTimeout(() => {
      let count = 0;
      const interval = setInterval(() => {
        count++;
        setVisibleLines(count);
        if (count >= totalLines + 2) clearInterval(interval);
      }, 40);
      return () => clearInterval(interval);
    }, 500);
    return () => clearTimeout(startTimer);
  }, []);

  return (
    <div style={{
      fontFamily: "'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 12, lineHeight: 1.5, padding: "8px 12px",
      color: text, background: bg, minHeight: "100%", overflowX: "auto",
    }}>
      {/* Initial prompt */}
      <div>
        <span style={{ color: labelColor }}>(base) </span>
        <span style={{ color: boldColor }}>Kevin@MacBookPro</span>
        <span style={{ color: text }}> ~ % neofetch</span>
      </div>

      {/* Neofetch output */}
      {Array.from({ length: Math.min(visibleLines, totalLines) }).map((_, i) => (
        <div key={i} style={{ whiteSpace: "pre", display: "flex" }}>
          <span style={{ color: LOGO_LINE_COLORS[i] || labelColor, minWidth: "40ch", display: "inline-block" }}>
            {NEOFETCH_LOGO[i] || ""}
          </span>
          {infoWithMemory[i] && (
            <span>
              {infoWithMemory[i].label ? (
                <>
                  <span style={{ color: infoWithMemory[i].color || boldColor, fontWeight: "bold" }}>{infoWithMemory[i].label}</span>
                  <span style={{ color: text }}>: {infoWithMemory[i].value}</span>
                </>
              ) : (
                <span style={{ color: infoWithMemory[i].color || text, fontWeight: "bold" }}>{infoWithMemory[i].value}</span>
              )}
            </span>
          )}
        </div>
      ))}

      {/* Color blocks */}
      {visibleLines > totalLines && (
        <div style={{ marginLeft: "40ch", marginTop: 8, display: "flex", gap: 0 }}>
          {NEOFETCH_COLORS.map((c) => (
            <div key={c} style={{ width: 24, height: 24, background: c }} />
          ))}
        </div>
      )}

      {/* Final prompt */}
      {visibleLines > totalLines + 1 && (
        <div style={{ marginTop: 8 }}>
          <span style={{ color: labelColor }}>(base) </span>
          <span style={{ color: boldColor }}>Kevin@MacBookPro</span>
          <span style={{ color: text }}> ~ % </span>
          <span style={{ animation: "terminal-blink 1s step-end infinite", color: cursorColor }}>█</span>
        </div>
      )}
    </div>
  );
};

/* ─── DesktopMenuBar ─── */

const DesktopMenuBar = ({ isDark }: { isDark: boolean }) => {
  const [time, setTime] = useState<Date | null>(null);
  const textPrimary = isDark ? "#fafafa" : "#09090b";
  const menuBarBg = isDark
    ? "rgba(0,0,0,0.55)"
    : "rgba(255,255,255,0.72)";
  const border = isDark
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.08)";

  useEffect(() => {
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 26,
        background: menuBarBg,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        fontSize: 12,
        fontWeight: 500,
        color: textPrimary,
        zIndex: 100,
        borderBottom: `1px solid ${border}`,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <AppleLogo />
        <span style={{ fontWeight: 700 }}>Finder</span>
        <span style={{ opacity: 0.5 }}>File</span>
        <span style={{ opacity: 0.5 }}>Edit</span>
        <span style={{ opacity: 0.5 }}>View</span>
      </div>
      {time && (
        <span style={{ opacity: 0.6, fontSize: 11 }}>
          {time.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}{" "}
          {time.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
};

/* ─── Desktop ─── */

const Desktop = () => {
  const { colorMode } = useColorMode();
  const isDark = colorMode === "dark";
  const router = useRouter();
  const folderContainerRef = useRef<HTMLDivElement>(null);

  const desktopBg = isDark
    ? "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1a1a2e 100%)"
    : "linear-gradient(135deg, #dbeafe 0%, #ede9fe 50%, #fce7f3 100%)";
  const hintBg = isDark
    ? "rgba(30,58,95,0.9)"
    : "rgba(219,234,254,0.95)";
  const hintColor = isDark ? "#93c5fd" : "#3b82f6";
  const border = isDark
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.08)";
  const textPrimary = isDark ? "#fafafa" : "#09090b";

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [openWindows, setOpenWindows] = useState<(Project & { zIndex: number })[]>([]);
  const [minimizedWindows, setMinimizedWindows] = useState<Project[]>([]);
  type GenieState = { type: "minimize" | "restore"; gx: number; gy: number };
  const [animatingWindows, setAnimatingWindows] = useState<Record<string, GenieState>>({});
  const zCounterRef = useRef(10);

  // App windows (Spotify, Terminal)
  const [openAppWindows, setOpenAppWindows] = useState<Record<string, number>>({}); // id -> zIndex
  const [minimizedAppIds, setMinimizedAppIds] = useState<string[]>([]);
  const [animatingApps, setAnimatingApps] = useState<Record<string, GenieState>>({});

  const calcGenieTarget = (windowId: string) => {
    const dockEl = document.querySelector("[data-dock]");
    const windowEl = document.querySelector(`[data-window-id="${windowId}"]`);
    if (!dockEl || !windowEl) return { gx: 0, gy: 0 };
    const dockRect = dockEl.getBoundingClientRect();
    const winRect = windowEl.getBoundingClientRect();
    return {
      gx: (dockRect.left + dockRect.width / 2) - (winRect.left + winRect.width / 2),
      gy: (dockRect.top + dockRect.height / 2) - (winRect.top + winRect.height / 2),
    };
  };

  const openProject = (proj: Project) => {
    // Restore from minimized if it was minimized
    const wasMinimized = minimizedWindows.find((w) => w.id === proj.id);
    if (wasMinimized) {
      restoreWindow(proj.id);
      return;
    }
    setOpenWindows((ws) => {
      const existing = ws.find((w) => w.id === proj.id);
      if (existing) {
        zCounterRef.current += 1;
        return ws.map((w) =>
          w.id === proj.id ? { ...w, zIndex: zCounterRef.current } : w
        );
      }
      zCounterRef.current += 1;
      return [...ws, { ...proj, zIndex: zCounterRef.current }];
    });
  };

  const closeWindow = (id: string) => {
    setOpenWindows((ws) => ws.filter((w) => w.id !== id));
    setMinimizedWindows((mw) => mw.filter((w) => w.id !== id));
  };

  const focusWindow = (id: string) => {
    zCounterRef.current += 1;
    const newZ = zCounterRef.current;
    setOpenWindows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, zIndex: newZ } : w))
    );
  };

  const minimizeWindow = (id: string) => {
    const win = openWindows.find((w) => w.id === id);
    if (!win) return;
    const target = calcGenieTarget(id);
    setAnimatingWindows((prev) => ({ ...prev, [id]: { type: "minimize", ...target } }));
    setTimeout(() => {
      setAnimatingWindows((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setMinimizedWindows((mw) => [...mw.filter((w) => w.id !== id), win]);
      setOpenWindows((ws) => ws.filter((w) => w.id !== id));
    }, 500);
  };

  const restoreWindow = (id: string) => {
    const proj = minimizedWindows.find((w) => w.id === id);
    if (!proj) return;
    // Calculate target before adding window (estimate from default pos)
    const dockEl = document.querySelector("[data-dock]");
    let gx = 0, gy = 0;
    if (dockEl) {
      const dockRect = dockEl.getBoundingClientRect();
      const desktopEl = folderContainerRef.current?.parentElement;
      if (desktopEl) {
        const dr = desktopEl.getBoundingClientRect();
        gx = (dockRect.left + dockRect.width / 2) - (dr.left + 80 + 340);
        gy = (dockRect.top + dockRect.height / 2) - (dr.top + 60 + 200);
      }
    }
    setMinimizedWindows((mw) => mw.filter((w) => w.id !== id));
    zCounterRef.current += 1;
    setOpenWindows((ws) => [...ws, { ...proj, zIndex: zCounterRef.current }]);
    setAnimatingWindows((prev) => ({ ...prev, [id]: { type: "restore", gx, gy } }));
    setTimeout(() => {
      setAnimatingWindows((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }, 400);
  };

  const expandWindow = (proj: Project) => {
    router.push(proj.href);
  };

  // App window handlers
  const openApp = (appId: string) => {
    if (minimizedAppIds.includes(appId)) { restoreApp(appId); return; }
    if (openAppWindows[appId] != null) {
      zCounterRef.current += 1;
      setOpenAppWindows((prev) => ({ ...prev, [appId]: zCounterRef.current }));
      return;
    }
    zCounterRef.current += 1;
    setOpenAppWindows((prev) => ({ ...prev, [appId]: zCounterRef.current }));
  };

  const closeApp = (appId: string) => {
    setOpenAppWindows((prev) => { const next = { ...prev }; delete next[appId]; return next; });
    setMinimizedAppIds((ids) => ids.filter((id) => id !== appId));
  };

  const focusApp = (appId: string) => {
    zCounterRef.current += 1;
    setOpenAppWindows((prev) => ({ ...prev, [appId]: zCounterRef.current }));
  };

  const minimizeApp = (appId: string) => {
    const target = calcGenieTarget(appId);
    setAnimatingApps((prev) => ({ ...prev, [appId]: { type: "minimize", ...target } }));
    setTimeout(() => {
      setAnimatingApps((prev) => { const next = { ...prev }; delete next[appId]; return next; });
      setMinimizedAppIds((ids) => [...ids.filter((id) => id !== appId), appId]);
      setOpenAppWindows((prev) => { const next = { ...prev }; delete next[appId]; return next; });
    }, 500);
  };

  const restoreApp = (appId: string) => {
    const dockEl = document.querySelector("[data-dock]");
    let gx = 0, gy = 0;
    if (dockEl) {
      const dockRect = dockEl.getBoundingClientRect();
      const desktopEl = folderContainerRef.current?.parentElement;
      if (desktopEl) {
        const dr = desktopEl.getBoundingClientRect();
        const initX = appId === "terminal" ? 140 : 200;
        const initY = appId === "terminal" ? 70 : 100;
        const w = appId === "terminal" ? 720 : 360;
        const h = appId === "terminal" ? 460 : 300;
        gx = (dockRect.left + dockRect.width / 2) - (dr.left + initX + w / 2);
        gy = (dockRect.top + dockRect.height / 2) - (dr.top + initY + h / 2);
      }
    }
    setMinimizedAppIds((ids) => ids.filter((id) => id !== appId));
    zCounterRef.current += 1;
    setOpenAppWindows((prev) => ({ ...prev, [appId]: zCounterRef.current }));
    setAnimatingApps((prev) => ({ ...prev, [appId]: { type: "restore", gx, gy } }));
    setTimeout(() => {
      setAnimatingApps((prev) => { const next = { ...prev }; delete next[appId]; return next; });
    }, 400);
  };

  const runningApps = [
    ...(openWindows.length > 0 || minimizedWindows.length > 0 ? ["finder"] : []),
    ...(openAppWindows["spotify"] != null || minimizedAppIds.includes("spotify") ? ["spotify"] : []),
    ...(openAppWindows["terminal"] != null || minimizedAppIds.includes("terminal") ? ["terminal"] : []),
  ];

  const minimizedAppItems = minimizedAppIds.map((id) => ({
    id,
    name: id === "spotify" ? "Spotify" : "Terminal",
    icon: id === "spotify" ? "/spotify-dock.png" : "/terminal-dock.png",
  }));

  return (
    <Box
      position="relative"
      h="100%"
      overflow="hidden"
      style={{ background: desktopBg }}
    >
      {/* Subtle dot pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: isDark ? 0.03 : 0.04,
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 0.5px, transparent 0)",
          backgroundSize: "24px 24px",
          color: textPrimary,
          pointerEvents: "none",
        }}
      />

      <DesktopMenuBar isDark={isDark} />

      {/* Hint bar */}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 0,
          right: 0,
          padding: "8px 14px",
          background: hintBg,
          fontSize: 12,
          fontWeight: 500,
          color: hintColor,
          display: "flex",
          alignItems: "center",
          gap: 6,
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${border}`,
          zIndex: 50,
        }}
      >
        <span style={{ opacity: 0.6 }}>ℹ️</span>
        HINT: Double click on the folders to open them
      </div>

      {/* Folder icons */}
      <div
        ref={folderContainerRef}
        style={{ position: "absolute", inset: "70px 0 0 0" }}
        onClick={() => setSelectedFolder(null)}
      >
        {PROJECTS.map((proj) => (
          <FolderIcon
            key={proj.id}
            project={proj}
            selected={selectedFolder === proj.id}
            isDark={isDark}
            onClick={() => setSelectedFolder(proj.id)}
            onDoubleClick={() => openProject(proj)}
            containerRef={folderContainerRef}
          />
        ))}
      </div>

      {/* Open Finder windows */}
      {openWindows.map((w) => (
        <FinderWindow
          key={w.id}
          project={w}
          isDark={isDark}
          zIndex={w.zIndex}
          onClose={() => closeWindow(w.id)}
          onFocus={() => focusWindow(w.id)}
          onExpand={() => expandWindow(w)}
          onMinimize={() => minimizeWindow(w.id)}
          animatingState={animatingWindows[w.id] || null}
        />
      ))}

      {/* Spotify window */}
      {openAppWindows["spotify"] != null && (
        <AppWindow
          appId="spotify"
          title="Spotify"
          isDark={isDark}
          zIndex={openAppWindows["spotify"]}
          onClose={() => closeApp("spotify")}
          onFocus={() => focusApp("spotify")}
          onMinimize={() => minimizeApp("spotify")}
          animatingState={animatingApps["spotify"] || null}
          width={380}
          height="auto"
          initialPos={{ x: 200, y: 100 }}
        >
          <SpotifyApp />
        </AppWindow>
      )}

      {/* Terminal window */}
      {openAppWindows["terminal"] != null && (
        <AppWindow
          appId="terminal"
          title="kevin@MacBookPro — zsh"
          isDark={isDark}
          zIndex={openAppWindows["terminal"]}
          onClose={() => closeApp("terminal")}
          onFocus={() => focusApp("terminal")}
          onMinimize={() => minimizeApp("terminal")}
          animatingState={animatingApps["terminal"] || null}
          width={720}
          height={460}
          initialPos={{ x: 140, y: 70 }}
          windowBgOverride="#141920"
          barBgOverride="#1c2530"
        >
          <TerminalContent />
        </AppWindow>
      )}

      {/* Dock */}
      <Dock
        isDark={isDark}
        minimizedWindows={minimizedWindows}
        onRestoreWindow={restoreWindow}
        onOpenApp={openApp}
        runningApps={runningApps}
        minimizedApps={minimizedAppItems}
        onRestoreApp={restoreApp}
      />
    </Box>
  );
};

/* ─── Mobile Desktop ─── */

const MobileAppScreen = ({
  appId,
  onClose,
  isDark,
}: {
  appId: string;
  onClose: () => void;
  isDark: boolean;
}) => {
  const [phase, setPhase] = useState<"launching" | "open" | "closing">("launching");

  useEffect(() => {
    const timer = setTimeout(() => setPhase("open"), 20);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setPhase("closing");
    setTimeout(onClose, 350);
  };

  const appBg = appId === "terminal" ? "#141920" : isDark ? "#1c1c1e" : "#f2f2f7";
  const statusBarColor = appId === "terminal" ? "#d1d7db" : isDark ? "#fff" : "#000";

  const isVisible = phase === "open";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: appBg,
        transform: isVisible ? "scale(1)" : "scale(0.1)",
        opacity: isVisible ? 1 : 0,
        borderRadius: isVisible ? 0 : "40px",
        transition: phase === "closing"
          ? "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.25s ease, border-radius 0.3s ease"
          : "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease, border-radius 0.35s ease",
        transformOrigin: "50% 90%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* iOS-style status bar area with back gesture */}
      <div
        style={{
          padding: "12px 16px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: appId === "terminal" ? "#1c2530" : isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.05)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: 0,
            color: appId === "terminal" ? "#3a71a4" : "#007AFF",
            fontSize: 15,
            fontWeight: 400,
          }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span> Back
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, color: statusBarColor }}>
          {appId === "spotify" ? "Spotify" : "Terminal"}
        </span>
        <span style={{ width: 50 }} />
      </div>

      {/* App content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {appId === "spotify" ? (
          <SpotifyApp />
        ) : (
          <TerminalContent />
        )}
      </div>

      {/* iOS home indicator */}
      <div style={{ padding: "8px 0 6px", display: "flex", justifyContent: "center", flexShrink: 0, background: appBg }}>
        <div style={{ width: 134, height: 5, borderRadius: 3, background: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }} />
      </div>
    </div>
  );
};

const MobileDesktop = () => {
  const { colorMode } = useColorMode();
  const isDark = colorMode === "dark";
  const router = useRouter();
  const folderContainerRef = useRef<HTMLDivElement>(null);
  const [openApp, setOpenApp] = useState<string | null>(null);

  const desktopBg = isDark
    ? "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1a1a2e 100%)"
    : "linear-gradient(135deg, #dbeafe 0%, #ede9fe 50%, #fce7f3 100%)";
  const hintBg = isDark
    ? "rgba(30,58,95,0.9)"
    : "rgba(219,234,254,0.95)";
  const hintColor = isDark ? "#93c5fd" : "#3b82f6";
  const border = isDark
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.08)";
  const textPrimary = isDark ? "#fafafa" : "#09090b";

  const runningApps = openApp ? [openApp] : [];

  return (
    <Box
      position="relative"
      flex="1"
      minH="400px"
      style={{ background: desktopBg, overflow: "hidden" }}
    >
      {/* Dot pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: isDark ? 0.03 : 0.04,
          backgroundImage:
            "radial-gradient(circle at 1px 1px, currentColor 0.5px, transparent 0)",
          backgroundSize: "24px 24px",
          color: textPrimary,
          pointerEvents: "none",
        }}
      />

      <DesktopMenuBar isDark={isDark} />

      {/* Hint bar */}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 0,
          right: 0,
          padding: "8px 14px",
          background: hintBg,
          fontSize: 12,
          fontWeight: 500,
          color: hintColor,
          display: "flex",
          alignItems: "center",
          gap: 6,
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${border}`,
          zIndex: 50,
        }}
      >
        <span style={{ opacity: 0.6 }}>ℹ️</span>
        HINT: Double tap on the folders to open them
      </div>

      {/* Folder icons */}
      <div
        ref={folderContainerRef}
        style={{ position: "absolute", inset: "70px 0 0 0" }}
      >
        {PROJECTS.map((proj) => (
          <FolderIcon
            key={proj.id}
            project={proj}
            selected={false}
            isDark={isDark}
            onClick={() => {}}
            onDoubleClick={() => router.push(proj.href)}
            containerRef={folderContainerRef}
          />
        ))}
      </div>

      {/* Full-screen app */}
      {openApp && (
        <MobileAppScreen appId={openApp} onClose={() => setOpenApp(null)} isDark={isDark} />
      )}

      {/* Dock */}
      <Dock
        isDark={isDark}
        minimizedWindows={[]}
        onRestoreWindow={() => {}}
        onOpenApp={(id) => setOpenApp((prev) => prev === id ? null : id)}
        runningApps={runningApps}
        minimizedApps={[]}
        onRestoreApp={() => {}}
      />
    </Box>
  );
};

/* ─── Main Export ─── */

export default function Projects() {
  const isDesktop = useBreakpointValue({ base: false, lg: true });

  return (
    <div style={{ overscrollBehavior: "contain" }}>
      <Meta title="Projects • Kevin Wong" />
      {isDesktop ? (
        <Box height="100vh" overflow="hidden">
          <Flex h="full" id="app-container">
            <Sidebar />
            <Box as="section" flex="1">
              <Desktop />
            </Box>
          </Flex>
        </Box>
      ) : (
        <Flex
          as="section"
          direction={{ base: "column", lg: "row" }}
          height="100vh"
          bg="bg-canvas"
          overflowY="auto"
        >
          <Navbar />
          <MobileDesktop />
        </Flex>
      )}
    </div>
  );
}
