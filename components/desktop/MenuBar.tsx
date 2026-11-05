import { LuSearch, LuWifi } from "react-icons/lu";
import styles from "./Desktop.module.css";
import { useMinuteClock } from "./hooks";
import { AppleLogo, ControlCenterIcon } from "./icons";
import { APPS, type AppId } from "./apps";

const formatClock = (d: Date) => {
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} ${date}  ${time}`;
};

/** Decorative, like the rest of the chrome: it names the frontmost app and shows the time. */
export const MenuBar = ({ app }: { app: AppId }) => {
  const now = useMinuteClock();
  const { name, menus } = APPS[app];

  return (
    <div className={styles.menubar} aria-hidden>
      <div className={styles.menubarGroup}>
        <span className={styles.menubarItem}>
          <AppleLogo />
        </span>
        <span className={`${styles.menubarItem} ${styles.menubarApp}`}>{name}</span>
        {menus.map((menu) => (
          <span key={menu} className={`${styles.menubarItem} ${styles.menubarMenu}`}>
            {menu}
          </span>
        ))}
      </div>
      <div className={styles.menubarGroup}>
        <span className={`${styles.menubarItem} ${styles.menubarStatus}`}>
          <LuWifi size={15} strokeWidth={2.2} />
        </span>
        <span className={`${styles.menubarItem} ${styles.menubarStatus}`}>
          <LuSearch size={14} strokeWidth={2.4} />
        </span>
        <span className={`${styles.menubarItem} ${styles.menubarStatus}`}>
          <ControlCenterIcon />
        </span>
        <span className={`${styles.menubarItem} ${styles.menubarClock}`}>{now && formatClock(now)}</span>
      </div>
    </div>
  );
};
