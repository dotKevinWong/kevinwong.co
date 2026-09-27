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
export const getStaticProps: GetStaticProps<{ macos: MacOSRelease }> = async () => ({
  props: { macos: await latestMacOS() },
  revalidate: 60 * 60 * 12,
});
