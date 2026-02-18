import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [
      ["book_id", "bookId"],
      ["book_title", "bookTitle"],
      ["book_author_name", "bookAuthorName"],
      ["author_name", "authorName"],
      ["author", "author"],
      ["dc:creator", "dcCreator"],
      ["book_small_image_url", "bookSmallImageUrl"],
      ["book_medium_image_url", "bookMediumImageUrl"],
      ["book_large_image_url", "bookLargeImageUrl"],
      ["user_rating", "userRating"],
      ["user_review", "userReview"],
      ["user_read_at", "userReadAt"],
      ["user_date_added", "userDateAdded"],
    ],
  },
});

const stripHtml = (text = "") =>
  String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clampRating = (ratingValue) => {
  const parsed = Number.parseInt(String(ratingValue ?? ""), 10);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.min(5, Math.max(0, parsed));
};

const formatReview = (reviewValue) => {
  const cleaned = stripHtml(reviewValue);

  if (cleaned.length <= 220) {
    return cleaned;
  }

  return `${cleaned.slice(0, 217)}...`;
};

const normalizeDate = (dateValue) => {
  if (!dateValue) {
    return null;
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

const resolveAuthor = (item) => {
  const directAuthor =
    item.bookAuthorName ||
    item.authorName ||
    item.author ||
    item.dcCreator ||
    item.creator;

  if (directAuthor) {
    return stripHtml(directAuthor);
  }

  const parsedTitle = stripHtml(item.title || "");
  const titleAuthorMatch = parsedTitle.match(/\sby\s(.+)$/i);

  if (titleAuthorMatch?.[1]) {
    return titleAuthorMatch[1].trim();
  }

  return "Unknown author";
};

const resolveLimit = (queryLimit) => {
  if (queryLimit === "all") {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number.parseInt(String(queryLimit ?? process.env.GOODREADS_MAX_BOOKS ?? "8"), 10);

  if (Number.isNaN(parsed)) {
    return 8;
  }

  return Math.min(Math.max(parsed, 1), 200);
};

export default async function handler(req, res) {
  const feedUrl = process.env.GOODREADS_RSS_URL;

  if (!feedUrl) {
    return res.status(200).json({
      configured: false,
      books: [],
      message: "Set GOODREADS_RSS_URL to enable Goodreads bookshelf data.",
    });
  }

  try {
    const limit = resolveLimit(req?.query?.limit);
    const feed = await parser.parseURL(feedUrl);

    const allBooks = (feed.items ?? [])
      .filter((item) => item.bookTitle || item.title)
      .map((item) => {
        const title = item.bookTitle || item.title || "Untitled";
        const bookId = item.bookId ? String(item.bookId) : null;
        const bookUrl = item.link || (bookId ? `https://www.goodreads.com/book/show/${bookId}` : null);

        return {
          id: bookId || `${title}-${item.pubDate ?? item.isoDate ?? ""}`,
          title,
          author: resolveAuthor(item),
          imageUrl:
            item.bookLargeImageUrl ||
            item.bookMediumImageUrl ||
            item.bookSmallImageUrl ||
            null,
          rating: clampRating(item.userRating),
          review: formatReview(item.userReview || item.contentSnippet || ""),
          readAt: normalizeDate(item.userReadAt || item.isoDate || item.pubDate || null),
          url: bookUrl,
        };
      });
    const books = Number.isFinite(limit) ? allBooks.slice(0, limit) : allBooks;

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");

    return res.status(200).json({
      configured: true,
      books,
      sourceTitle: feed.title ?? "Goodreads",
    });
  } catch (error) {
    return res.status(500).json({
      configured: true,
      books: [],
      message: "Unable to load Goodreads feed.",
      error: String(error?.message || error),
    });
  }
}
