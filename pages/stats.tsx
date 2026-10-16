import { StatisticsPage } from "../components/pages/Statistics";
import { Meta } from "../components/Meta";
import { PageShell } from "../components/PageShell";

export default function Statistics() {
    return (
        <>
            <Meta title="Statistics • Kevin Wong" />
            <PageShell>
                <StatisticsPage />
            </PageShell>
        </>
    );
}
