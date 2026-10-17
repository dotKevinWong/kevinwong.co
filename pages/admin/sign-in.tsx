import type { GetServerSideProps } from "next";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";
import { SignInPage } from "../../components/admin/SignInPage";
import { getOwnerSession, isAdminEnabled, setNoStore } from "../../lib/admin/guard";
import { errorCodeFromQuery } from "../../lib/admin/messages";
import { describeError } from "../../lib/redact";

type Props = { error: string | null };

export const getServerSideProps = (async ({ req, res, query }) => {
    setNoStore(res);
    if (!isAdminEnabled(req)) return { notFound: true };
    let owner;
    try { owner = await getOwnerSession(req); } catch (error) {
        console.error("[admin] owner check failed:", describeError(error));
        throw new Error("Admin page unavailable");
    }
    if (owner) return { redirect: { destination: "/admin", permanent: false } };
    return { props: { error: errorCodeFromQuery(query.error) } };
}) satisfies GetServerSideProps<Props>;

export default function AdminSignIn({ error }: Props) {
    return (
        <>
            <Meta title="Sign in • Kevin Wong" noindex />
            <PageShell>
                <SignInPage error={error} />
            </PageShell>
        </>
    );
}
