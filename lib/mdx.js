import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { DEFAULT_OG_IMAGE, SITE_ORIGIN } from "./site.js";

// gray-matter types front matter as `any`; this is the shape getPost()
// guarantees once the defaults below are filled in.
/**
 * @typedef {object} PostMeta
 * @property {string} slug
 * @property {string} excerpt
 * @property {string} title
 * @property {string} author
 * @property {string} author_avatar
 * @property {string} og_image
 * @property {string[]} tags
 * @property {string} date
 */

/**
 * @param {string} pid
 * @returns {Promise<{ content: string, meta: PostMeta }>}
 */
export async function getPost(pid) {
	const postPath = path.join(process.cwd(), "posts", `${pid}.mdx`)
	// use fs to read the file as a string
	const source = fs.readFileSync(postPath, "utf8");
	const { content, data } = matter(source);

	return {
		content,
		meta: {
			slug: pid,
			excerpt: data.excerpt ?? "No excerpt",
			title: data.title ?? pid,
			author: data.author ?? "Kevin Wong",
			author_avatar: data.author_image ?? `${SITE_ORIGIN}/me.jpg`,
			og_image: data.og_image ?? DEFAULT_OG_IMAGE,
			tags: (data.tags ?? []).sort(),
			date: (data.date ?? new Date()).toString(),
		},
	};
}

// A post's filename without its extension is its URL segment. Empty if posts/ is missing.
export async function getPostSlugs() {
	try {
		return fs
			.readdirSync(path.join(process.cwd(), "posts"))
			.filter((file) => file.endsWith(".mdx"))
			.map((file) => file.slice(0, -".mdx".length));
	} catch {
		return [];
	}
}

// Create a function to get all the posts and return them as an array of objects with the title, excerpt, tags, and date
export async function getAllPosts() {
	const slugs = await getPostSlugs();
	const filtered = slugs.map(async (slug) => {
		const { meta } = await getPost(slug);
		return meta;
	});

	// sort the filtered posts by date in descending order
	const sorted = (await Promise.all(filtered)).sort((a, b) => {
		return new Date(b.date).getTime() - new Date(a.date).getTime();
	});

	return sorted;
}
