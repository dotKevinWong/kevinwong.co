import type { BoxProps } from "@chakra-ui/react";
import { Card } from "../Card";

/** The site's card look (TopTracks, GitHubStats), full width for the admin pages. */
export const AdminCard = (props: BoxProps) => <Card w="full" {...props} />;
