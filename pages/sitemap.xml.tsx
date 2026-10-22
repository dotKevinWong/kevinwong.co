import type { GetServerSideProps } from "next";
import { PROJECTS } from "../components/projects/data";
import { getPosts } from "../lib/mdx";

const SITE_URL = "https://www.kevinwong.co";

// The sidebar's pages, in its order.
const PAGES = ["/", "/stats", "/bookshelf", "/snapshots", "/projects", "/blog", "/contact"];

// The sitemap protocol requires each <loc> to be entity-escaped.
const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

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
    // A post's filename is its URL segment, as in pages/blog/[id].tsx.
    ...posts.map((file) => `/blog/${encodeURIComponent(file.replace(/\.mdx$/, ""))}`),
  ];

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=86400");
  res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${escapeXml(`${SITE_URL}${path}`)}</loc></url>`).join("\n")}
</urlset>
`);

  return { props: {} };
};

export default function Sitemap() {
  return null;
}
