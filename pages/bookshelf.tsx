import { Meta } from "../components/Meta";
import { PageShell } from "../components/PageShell";
import { BookshelfPage } from "../components/pages/Bookshelf";

export default function Bookshelf() {
  return (
    <>
      <Meta title="Bookshelf • Kevin Wong" />
      <PageShell>
        <BookshelfPage />
      </PageShell>
    </>
  );
}
