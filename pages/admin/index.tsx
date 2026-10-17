import type { GetServerSideProps } from "next";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";
import { AdminPage } from "../../components/admin/AdminPage";
import type { AdminPageProps, AdminStatus } from "../../components/admin/types";
import { getOwnerSession, isAdminEnabled, setNoStore } from "../../lib/admin/guard";
import { flashFromQuery } from "../../lib/admin/messages";
import { OWNER_GITHUB_LOGIN } from "../../lib/admin/owner";
import { buildAdminStatus } from "../../lib/admin/status";
import { describeError } from "../../lib/redact";

export const getServerSideProps = (async ({ req, res, query }) => {
    setNoStore(res);
    if (!isAdminEnabled(req)) return { notFound: true };
    let owner;
    try { owner = await getOwnerSession(req); } catch (error) {
        // If ownership can't be confirmed, the page must not render.
        console.error("[admin] owner check failed:", describeError(error));
        throw new Error("Admin page unavailable");
    }
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
