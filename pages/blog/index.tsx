import type { InferGetStaticPropsType } from "next";
import { getAllPosts } from "../../lib/mdx";
import { BlogPage } from "../../components/pages/Blog";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";

export default function Blog({ posts }: InferGetStaticPropsType<typeof getStaticProps>) {
    return (
      <>
        <Meta title="Blog • Kevin Wong" />
        <PageShell>
          <BlogPage posts={posts} />
        </PageShell>
      </>
    );
}

// use getStaticProps to get all the posts
export async function getStaticProps() {
    const posts = await getAllPosts();
    return { props: { posts } };
}