import fs from "fs";
import path from "path";
import matter from "gray-matter";

export async function getPost(pid) {
	// const postPath = path.join(process.cwd(), 'posts', `${pid}.md`)
	const postPath = path.join(process.cwd(), "posts", `${pid}.mdx`)
	// filter out .DS_Store (on Mac) and other system files
	if (postPath.includes(".DS_Store")) {
		return;
	}
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
			author_avatar: data.author_image ?? "https://kevinwong.co/me.jpg",
			og_image: data.og_image ?? "https://kevinwong.co/og.jpg",
			tags: (data.tags ?? []).sort(),
			date: (data.date ?? new Date()).toString(),
		},
	};
}

export async function getPosts() {
	try {
		const posts = fs.readdirSync(path.join(process.cwd(), "posts"));
		if (posts.includes(".DS_Store")) {
			posts.splice(posts.indexOf(".DS_Store"), 1);
		}
		return posts;
	} catch (e) {
		return [];
	}
}

// Create a function to get all the posts and return them as an array of objects with the title, excerpt, tags, and date
export async function getAllPosts() {
	const posts = await getPosts();
	const filtered = posts.map(async (post) => {
		const { meta } = await getPost(post.replace(/\.mdx?$/, ""));
		return meta;
	});

	// sort the filtered posts by date in descending order
	const sorted = (await Promise.all(filtered)).sort((a, b) => {
		return new Date(b.date).getTime() - new Date(a.date).getTime();
	});

	return sorted;
}
