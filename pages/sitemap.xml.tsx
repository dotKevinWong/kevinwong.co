import type { GetServerSideProps } from "next";
import { PROJECTS } from "../components/projects/data";
import { getPosts } from "../lib/mdx";

const SITE_URL = "https://www.kevinwong.co";

// The sidebar's pages, in its order.
const PAGES = ["/", "/stats", "/bookshelf", "/snapshots", "/projects", "/blog", "/contact"];

/**
 * Served as /sitemap.xml (robots.txt points here). Lists every page, including
 * each project and blog post, which crawlers otherwise only reach through /blog
 * and the Projects desktop.
 */
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const posts = await getPosts();
  const paths = [
    ...PAGES,
    ...PROJECTS.map((project) => project.href),
    ...posts.map((file) => `/blog/${file.replace(/\.mdx$/, "")}`),
  ];

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=86400");
  res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join("\n")}
</urlset>
`);

  return { props: {} };
};

export default function Sitemap() {
  return null;
}
