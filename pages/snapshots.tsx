import { SnapshotsPage } from "../components/pages/Snapshots";
import { Meta } from "../components/Meta";
import { PageShell } from "../components/PageShell";

export default function Snapshots() {
    return (
        <>
            <Meta title="Snapshots • Kevin Wong" />
            <PageShell>
                <SnapshotsPage />
            </PageShell>
        </>
    );
}
