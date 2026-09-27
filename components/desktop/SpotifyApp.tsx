import React, { useEffect, useRef } from "react";
import { IoPause, IoPlay, IoPlaySkipBack, IoPlaySkipForward, IoRepeat, IoShuffle, IoVolumeHigh } from "react-icons/io5";
import styles from "./Desktop.module.css";
import { formatDuration, useNowPlaying, useReducedMotion } from "./hooks";

/* ─── Visualizer ─────────────────────────────────────────────── */

// The plasma is computed on a grid this many pixels apart and scaled up.
const CELL = 5;

const hsl = (h: number, s: number, l: number): [number, number, number] => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
};

/** A psychedelic, Windows Media Player style visualizer. Calm purple when idle. */
const Visualizer = ({ playing, paused = false }: { playing: boolean; paused?: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const buffer = document.createElement("canvas");
    const bctx = buffer.getContext("2d");
    if (!canvas || !ctx || !bctx) return;

    let W = 0;
    let H = 0;
    let image: ImageData | null = null;
    let t = 0;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, canvas.clientWidth);
      H = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buffer.width = Math.ceil(W / CELL) + 1;
      buffer.height = Math.ceil(H / CELL) + 1;
      image = bctx.createImageData(buffer.width, buffer.height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    };

    const plasma = (pixel: (x: number, y: number) => [number, number, number, number]) => {
      if (!image) return;
      const { data, width, height } = image;
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const [r, g, b, a] = pixel(px * CELL, py * CELL);
          const i = (py * width + px) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
        }
      }
      bctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buffer, 0, 0, buffer.width * CELL, buffer.height * CELL);
    };

    const drawIdle = () => {
      t += 0.005;
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(0, 0, W, H);
      plasma((x, y) => {
        const v = Math.sin(x * 0.02 + t) + Math.sin(y * 0.02 + t * 0.7);
        return [...hsl(260, 0.6, ((v + 2) / 4) * 0.3), 255];
      });
    };

    const drawPlaying = () => {
      t += 0.03;
      const cx = W / 2;
      const cy = H / 2;
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, 0, W, H);

      plasma((x, y) => {
        const dx = (x - cx) / W;
        const dy = (y - cy) / H;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const v =
          (Math.sin(x * 0.025 + t * 1.3) +
            Math.sin(y * 0.02 - t * 0.9) +
            Math.sin((x + y) * 0.015 + t) +
            Math.sin(dist * 8 - t * 2)) /
          4;
        const hue = ((v + 1) * 180 + t * 40) % 360;
        return [...hsl(hue, 1, (40 + v * 25) / 100), 255 * (0.45 + v * 0.15)];
      });

      // Radial waveform rings
      ctx.lineWidth = 1.5;
      for (let ring = 0; ring < 3; ring++) {
        ctx.beginPath();
        const base = 20 + ring * 18;
        ctx.strokeStyle = `hsla(${(t * 60 + ring * 120) % 360}, 100%, 65%, 0.7)`;
        for (let a = 0; a <= Math.PI * 2; a += 0.04) {
          const r = base + Math.sin(a * 6 + t * 3 + ring) * 8 + Math.sin(a * 10 - t * 5) * 4 + Math.sin(a * 3 + t * 2) * 6;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // Flowing sine waves
      ctx.lineWidth = 2;
      for (let w = 0; w < 4; w++) {
        ctx.beginPath();
        ctx.strokeStyle = `hsla(${(t * 50 + w * 90) % 360}, 100%, 60%, 0.6)`;
        for (let x = 0; x < W; x += 2) {
          const y =
            H * 0.7 + Math.sin(x * 0.04 + t * 2 + w) * 12 + Math.sin(x * 0.02 - t * 1.5 + w * 2) * 8 + Math.cos(x * 0.06 + t * 3) * 5;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Sparkles
      for (let i = 0; i < 6; i++) {
        const angle = t * 2 + (i * Math.PI * 2) / 6;
        const r = 30 + Math.sin(t * 3 + i) * 20;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${(t * 80 + i * 60) % 360}, 100%, 80%, 0.9)`;
        ctx.fill();
      }
    };

    const draw = playing ? drawPlaying : drawIdle;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      // While minimized, keep the last frame on the canvas for the Dock preview.
      if (paused) return;
      resize();
      if (reducedMotion) {
        // Build up one still frame instead of animating.
        for (let i = 0; i < 12; i++) draw();
        return;
      }
      loop();
    };

    const observer = new ResizeObserver(start);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [playing, paused, reducedMotion]);

  return <canvas ref={canvasRef} className={styles.visualizer} aria-hidden />;
};

/* ─── Shared bits ────────────────────────────────────────────── */

const ExternalLink = ({ href, className, children }: { href?: string; className?: string; children: React.ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );

const ProgressBar = ({ pct }: { pct: number }) => (
  <div className={styles.spTrackBar}>
    <div className={styles.spTrackFill} style={{ width: `${pct}%` }} />
  </div>
);

/* ─── Window layout ──────────────────────────────────────────── */

export const SpotifyApp = ({ paused }: { paused?: boolean }) => {
  const { data, hasTrack, isPlaying, current, total, pct } = useNowPlaying();
  const eyebrow = isPlaying ? "Now playing" : hasTrack ? "Paused" : "Spotify";

  return (
    <div className={styles.spotify}>
      <div className={styles.spStage}>
        <Visualizer playing={isPlaying} paused={paused} />
        <div className={styles.spOverlay}>
          <div className={styles.spEyebrow}>{eyebrow}</div>
          {hasTrack ? (
            <>
              <ExternalLink href={data?.songUrl} className={styles.spTitle}>
                {data?.title}
              </ExternalLink>
              <ExternalLink href={data?.artistUrl} className={styles.spArtist}>
                {data?.artist}
              </ExternalLink>
            </>
          ) : (
            <span className={styles.spTitle}>Not Playing</span>
          )}
        </div>
      </div>

      <div className={styles.spBar}>
        <div className={styles.spTrack}>
          <ExternalLink href={data?.albumUrl}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.spArt} src={hasTrack ? data?.albumImageUrl : "/album.png"} alt={data?.album ?? ""} />
          </ExternalLink>
          <div className={styles.spTrackText}>
            <ExternalLink href={data?.songUrl} className={styles.spTrackTitle}>
              {hasTrack ? data?.title : "Not Playing"}
            </ExternalLink>
            <ExternalLink href={data?.artistUrl} className={styles.spTrackArtist}>
              {hasTrack ? data?.artist : "Spotify"}
            </ExternalLink>
          </div>
        </div>

        <div className={styles.spControls} aria-hidden>
          <div className={styles.spButtons}>
            <IoShuffle size={16} />
            <IoPlaySkipBack size={16} />
            <span className={styles.spPlay}>{isPlaying ? <IoPause size={16} /> : <IoPlay size={16} style={{ marginLeft: 2 }} />}</span>
            <IoPlaySkipForward size={16} />
            <IoRepeat size={16} />
          </div>
          <div className={styles.spProgress}>
            <span>{formatDuration(current)}</span>
            <ProgressBar pct={pct} />
            <span>{formatDuration(total)}</span>
          </div>
        </div>

        <div className={styles.spVolume} aria-hidden>
          <IoVolumeHigh size={16} />
          <ProgressBar pct={65} />
        </div>
      </div>
    </div>
  );
};

/* ─── Full-screen (phone) layout ─────────────────────────────── */

export const SpotifyMobile = () => {
  const { data, hasTrack, isPlaying, current, total, pct } = useNowPlaying();
  const art = hasTrack ? data?.albumImageUrl : "/album.png";

  return (
    <div className={styles.spMobile}>
      <div className={styles.spMobileStage}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.spMobileBackdrop} src={art} alt="" aria-hidden />
        <div className={styles.spMobileViz}>
          <Visualizer playing={isPlaying} />
        </div>
        <ExternalLink href={data?.albumUrl} className={styles.spMobileArtLink}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.spMobileArt} src={art} alt={data?.album ?? ""} />
        </ExternalLink>
      </div>

      <div className={styles.spMobileInfo}>
        <ExternalLink href={data?.songUrl} className={styles.spTitle}>
          {hasTrack ? data?.title : "Not Playing"}
        </ExternalLink>
        <ExternalLink href={data?.artistUrl} className={styles.spArtist}>
          {hasTrack ? data?.artist : "Spotify"}
        </ExternalLink>
      </div>

      <div className={styles.spMobileProgress} aria-hidden>
        <ProgressBar pct={pct} />
        <div className={styles.spMobileTimes}>
          <span>{formatDuration(current)}</span>
          <span>-{formatDuration(total - current)}</span>
        </div>
      </div>

      <div className={styles.spMobileControls} aria-hidden>
        <IoPlaySkipBack size={26} />
        <span className={styles.spPlay}>{isPlaying ? <IoPause size={26} /> : <IoPlay size={26} style={{ marginLeft: 3 }} />}</span>
        <IoPlaySkipForward size={26} />
      </div>
    </div>
  );
};
