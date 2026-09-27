import { Box, Button } from "@chakra-ui/react";
import Link from "next/link";
import React from "react";
import { LuChevronLeft } from "react-icons/lu";
import { Meta } from "../Meta";
import { PageShell } from "../PageShell";
import { getProject, type ProjectId } from "./data";
import { ProjectDetail } from "./ProjectDetail";

export const ProjectPage = ({ id }: { id: ProjectId }) => {
  const project = getProject(id);

  return (
    <>
      <Meta title={`${project.name} • Kevin Wong`} ogDesc={project.sections[0]?.body} />
      <PageShell>
        <Box pt={{ base: "3", md: "4" }} px={{ base: "2", md: "3" }}>
          <Button asChild variant="ghost" size="sm" colorPalette="blue" color={{ base: "blue.600", _dark: "blue.300" }}>
            <Link href="/projects">
              <LuChevronLeft />
              Projects
            </Link>
          </Button>
        </Box>
        <ProjectDetail project={project} />
      </PageShell>
    </>
  );
};
