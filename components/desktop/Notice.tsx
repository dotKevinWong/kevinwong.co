import React from "react";
import styles from "./Desktop.module.css";
import { CloseGlyph } from "./icons";

/** A macOS notification banner. */
export const Notice = ({ title, body, icon, onDismiss }: { title: string; body: string; icon: string; onDismiss: () => void }) => (
  <div className={styles.notice} role="status" onClick={onDismiss}>
    <button type="button" className={styles.noticeClose} aria-label="Dismiss notification" onClick={onDismiss}>
      <CloseGlyph />
    </button>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className={styles.noticeIcon} src={icon} alt="" draggable={false} />
    <div className={styles.noticeText}>
      <div className={styles.noticeHeader}>
        <span className={styles.noticeTitle}>{title}</span>
        <span className={styles.noticeTime}>now</span>
      </div>
      <div>{body}</div>
    </div>
  </div>
);
