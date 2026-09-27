import React from "react";
import { Desktop } from "../../components/desktop/Desktop";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";

export default function Projects() {
  return (
    <>
      <Meta title="Projects • Kevin Wong" />
      <PageShell scroll={false}>
        <Desktop />
      </PageShell>
    </>
  );
}
