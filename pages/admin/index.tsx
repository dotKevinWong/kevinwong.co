import type { GetServerSideProps } from "next";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";
import { AdminPage } from "../../components/admin/AdminPage";
import type { AdminPageProps, AdminStatus } from "../../components/admin/types";
import { ownerForPage } from "../../lib/admin/guard";
import { flashFromQuery } from "../../lib/admin/messages";
import { OWNER_GITHUB_LOGIN } from "../../lib/admin/owner";
import { buildAdminStatus } from "../../lib/admin/status";
import { describeError } from "../../lib/redact";

export const getServerSideProps = (async ({ req, res, query }) => {
    const gate = await ownerForPage(req, res);
    if ("notFound" in gate) return gate;
    const { owner } = gate;
    if (!owner) return { redirect: { destination: "/admin/sign-in", permanent: false } };
    let initialStatus: AdminStatus | null = null;
    try {
        // The JSON round trip guarantees serialisable props even if a Date slips through.
        initialStatus = JSON.parse(JSON.stringify(await buildAdminStatus()));
    } catch (e) {
        // Render anyway: the dashboard shows "Couldn't load the status" and SWR retries.
        console.error("[admin] buildAdminStatus failed:", describeError(e));
    }
    return { props: {
        owner: { name: owner.name, image: owner.image ?? null, login: OWNER_GITHUB_LOGIN },
        initialStatus, flash: flashFromQuery(query),
    } };
}) satisfies GetServerSideProps<AdminPageProps>;

export default function Admin(props: AdminPageProps) {
    return (<><Meta title="Admin • Kevin Wong" noindex /><PageShell><AdminPage {...props} /></PageShell></>);
}
