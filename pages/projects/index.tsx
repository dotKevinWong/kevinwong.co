import type { GetStaticProps } from "next";
import React from "react";
import { Desktop } from "../../components/desktop/Desktop";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";
import { latestMacOS, type MacOSRelease } from "../../lib/macos";

export default function Projects({ macos }: { macos: MacOSRelease }) {
  return (
    <>
      <Meta title="Projects • Kevin Wong" />
      <PageShell scroll={false}>
        <Desktop macos={macos} />
      </PageShell>
    </>
  );
}

// Re-checked twice a day so the Terminal's neofetch follows new macOS releases.
export const getStaticProps: GetStaticProps<{ macos: MacOSRelease }> = async () => {
  const { release, checked } = await latestMacOS();
  // If both feeds are down during a background refresh, throwing makes Next keep
  // serving the last good page rather than drop back to the fallback. The build
  // itself never fails over this.
  if (!checked && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("Couldn't check the latest macOS release; keeping the previous page.");
  }
  return { props: { macos: release }, revalidate: 60 * 60 * 12 };
};
