import { Box } from "@chakra-ui/react";
import { HomePage } from "../components/pages/Home";
import { Meta } from "../components/Meta";
import { PageShell } from "../components/PageShell";

export default function Home() {
  return (
    <>
      <Meta title="Kevin Wong" ogDesc="I'm Kevin, a Software Engineer based in Philly. 2022 B.S. Software Engineering from Drexel University. Consultant at SAP."/>
      <PageShell>
        <Box maxW={{ lg: "4xl" }}>
          <HomePage />
        </Box>
      </PageShell>
    </>
  );
}
