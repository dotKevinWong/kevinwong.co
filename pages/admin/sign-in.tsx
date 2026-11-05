import type { GetServerSideProps } from "next";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";
import { SignInPage } from "../../components/admin/SignInPage";
import { ownerForPage } from "../../lib/admin/guard";
import { errorCodeFromQuery } from "../../lib/admin/messages";

type Props = { error: string | null };

export const getServerSideProps = (async ({ req, res, query }) => {
    const gate = await ownerForPage(req, res);
    if ("notFound" in gate) return gate;
    if (gate.owner) return { redirect: { destination: "/admin", permanent: false } };
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
