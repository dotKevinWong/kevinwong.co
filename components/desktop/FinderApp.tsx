import Link from "next/link";
import React, { useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight, LuFolder, LuSquareArrowOutUpRight } from "react-icons/lu";
import { PROJECTS, getProject, type ProjectId } from "../projects/data";
import { ProjectDetail } from "../projects/ProjectDetail";
import styles from "./Desktop.module.css";
import { FolderGlyph } from "./icons";
import type { FinderLocation } from "./windowManager";

const DOUBLE_CLICK_MS = 450;

export const locationTitle = (location: FinderLocation) => (location === "root" ? "Projects" : getProject(location).name);

/** Icon view of the Projects folder. Click selects, double-click (or Enter) opens. */
const ProjectGrid = ({ onOpen }: { onOpen: (id: ProjectId) => void }) => {
  const [selected, setSelected] = useState<ProjectId | null>(null);
  const lastClick = useRef({ id: null as ProjectId | null, at: 0 });

  return (
    <div
      className={styles.finderGrid}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setSelected(null);
      }}
    >
      {PROJECTS.map((project) => (
        <button
          key={project.id}
          type="button"
          className={`${styles.gridItem} ${selected === project.id ? styles.gridItemSelected : ""}`}
          aria-label={`${project.name} folder`}
          onClick={(e) => {
            const prev = lastClick.current;
            lastClick.current = { id: project.id, at: e.timeStamp };
            setSelected(project.id);
            if (e.detail > 0 && prev.id === project.id && e.timeStamp - prev.at < DOUBLE_CLICK_MS) onOpen(project.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onOpen(project.id);
            }
          }}
        >
          <span className={styles.iconImage}>
            <FolderGlyph size={64} badge={project.logo} badgeFit={project.logoFit} />
          </span>
          <span className={styles.iconLabel}>{project.name}</span>
        </button>
      ))}
    </div>
  );
};

/** The contents of a Finder window: sidebar, toolbar with history, and the current folder. */
export const FinderApp = ({
  location,
  canBack,
  canForward,
  onNavigate,
  onGo,
}: {
  location: FinderLocation;
  canBack: boolean;
  canForward: boolean;
  onNavigate: (location: FinderLocation) => void;
  onGo: (delta: number) => void;
}) => {
  const project = location === "root" ? null : getProject(location);

  return (
    <div className={styles.finder}>
      <nav className={styles.finderSidebar} data-drag-region aria-label="Sidebar">
        <div className={styles.sidebarHeading}>Favorites</div>
        <button
          type="button"
          className={`${styles.sidebarItem} ${location === "root" ? styles.sidebarItemSelected : ""}`}
          aria-current={location === "root" ? "page" : undefined}
          onClick={() => onNavigate("root")}
        >
          <LuFolder size={16} />
          Projects
        </button>
        {PROJECTS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.sidebarItem} ${location === p.id ? styles.sidebarItemSelected : ""}`}
            aria-current={location === p.id ? "page" : undefined}
            onClick={() => onNavigate(p.id)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.sidebarAvatar} src={p.logo} alt="" style={{ objectFit: p.logoFit }} />
            {p.name}
          </button>
        ))}
      </nav>

      <div className={styles.finderMain}>
        <div className={styles.finderToolbar} data-drag-region>
          <button type="button" className={styles.toolButton} aria-label="Back" disabled={!canBack} onClick={() => onGo(-1)}>
            <LuChevronLeft />
          </button>
          <button
            type="button"
            className={styles.toolButton}
            aria-label="Forward"
            disabled={!canForward}
            onClick={() => onGo(1)}
          >
            <LuChevronRight />
          </button>
          <div className={styles.finderTitle}>{locationTitle(location)}</div>
          {project && (
            <Link href={project.href} className={styles.toolButton} aria-label="Open as a page" title="Open as a page">
              <LuSquareArrowOutUpRight />
            </Link>
          )}
        </div>

        <div className={styles.finderContent}>
          {project ? <ProjectDetail project={project} /> : <ProjectGrid onOpen={onNavigate} />}
        </div>

        {!project && <div className={styles.finderStatus}>{PROJECTS.length} items</div>}
      </div>
    </div>
  );
};

/** Phone-sized Finder: a list of projects that open as pages. */
export const FinderList = () => (
  <div className={styles.fileList}>
    <div className={styles.fileListGroup}>
      {PROJECTS.map((p) => (
        <Link key={p.id} href={p.href} className={styles.fileRow}>
          <FolderGlyph size={40} badge={p.logo} badgeFit={p.logoFit} />
          <span className={styles.fileRowText}>
            <span className={styles.fileRowName}>{p.name}</span>
            <span className={styles.fileRowMeta}>{p.subtitle}</span>
          </span>
          <LuChevronRight className={styles.fileRowChevron} />
        </Link>
      ))}
    </div>
  </div>
);
