import { Box } from "@chakra-ui/react";
import { ContactPage } from "../components/pages/Contact";
import { Meta } from "../components/Meta";
import { PageShell } from "../components/PageShell";

export default function Contact() {
    return (
        <>
            <Meta title="Contact • Kevin Wong" />
            <PageShell>
                <Box maxW={{ lg: "4xl" }}>
                    <ContactPage />
                </Box>
            </PageShell>
        </>
    );
}
