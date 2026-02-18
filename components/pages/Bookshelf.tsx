import {
  Box,
  Heading,
  VStack,
  Text,
  Link,
  Image,
  SimpleGrid,
  Badge,
  HStack,
  useBreakpointValue,
} from "@chakra-ui/react";
import * as React from "react";
import useSWR from "swr";
import fetcher from "../../lib/fetcher";
import { FiExternalLink } from "react-icons/fi";

type BookshelfBook = {
  id: string;
  title: string;
  author: string;
  imageUrl: string | null;
  rating: number;
  review: string;
  readAt: string | null;
  url: string | null;
};

type BookshelfResponse = {
  configured: boolean;
  books: BookshelfBook[];
  message?: string;
};

const chunkBooks = (books: BookshelfBook[], chunkSize: number) => {
  if (chunkSize <= 0) {
    return [books];
  }

  const chunks: BookshelfBook[][] = [];

  for (let index = 0; index < books.length; index += chunkSize) {
    chunks.push(books.slice(index, index + chunkSize));
  }

  return chunks;
};

const formatDate = (dateValue: string | null) => {
  if (!dateValue) {
    return "Read date unavailable";
  }

  const parsed = new Date(dateValue);

  if (Number.isNaN(parsed.getTime())) {
    return "Read date unavailable";
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const ratingLabel = (rating: number) => (rating ? `${rating}/5` : "Not rated");

export const BookshelfPage = () => {
  const { data } = useSWR<BookshelfResponse>("/api/bookshelf?limit=all", fetcher, {
    refreshInterval: 900000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const booksPerShelf = useBreakpointValue({ base: 2, sm: 3, md: 4, xl: 5 }) ?? 3;
  const shelves = React.useMemo(() => chunkBooks(data?.books ?? [], booksPerShelf), [data?.books, booksPerShelf]);

  return (
    <Box as="section" flex="1" p="6" overflow="auto">
      <VStack align="stretch" gap={6}>
        <VStack align="left" gap={1}>
          <Heading size="2xl">Bookshelf</Heading>
          {data?.configured && data.books.length > 0 ? (
            <Text fontSize="sm" color={{ base: "gray.600", _dark: "gray.300" }}>
              Showing {data.books.length} books
            </Text>
          ) : null}
        </VStack>

        {!data ? <Text>Loading bookshelf...</Text> : null}

        {data && !data.configured ? (
          <Text>
            Goodreads feed not configured yet. Add <code>GOODREADS_RSS_URL</code> to your environment.
          </Text>
        ) : null}

        {data?.configured && data.books.length === 0 ? <Text>No books found yet.</Text> : null}

        {data?.configured
          ? shelves.map((shelf, shelfIndex) => (
              <Box
                key={`shelf-${shelfIndex}`}
                bgGradient="linear(to-b, #c38a4d, #8a5427)"
                borderRadius="lg"
                border="1px solid"
                borderColor="blackAlpha.300"
                boxShadow="inset 0 3px 0 rgba(255, 255, 255, 0.22), 0 6px 12px rgba(0, 0, 0, 0.24)"
                p={{ base: 3, md: 4 }}
              >
                <SimpleGrid columns={booksPerShelf} gap={{ base: 3, md: 4 }} alignItems="stretch">
                  {shelf.map((book) => (
                    <Box
                      key={book.id}
                      bg={{ base: "rgba(255, 248, 232, 0.98)", _dark: "rgba(20, 20, 20, 0.95)" }}
                      borderRadius="md"
                      border="1px solid"
                      borderColor={{ base: "blackAlpha.200", _dark: "whiteAlpha.200" }}
                      p={3}
                      minH="100%"
                    >
                      {book.url ? (
                        <Link as="a" href={book.url} target="_blank" rel="noreferrer">
                          <Image
                            src={book.imageUrl || "/album.png"}
                            alt={book.title}
                            width="100%"
                            height={{ base: "180px", md: "220px" }}
                            objectFit="cover"
                            borderRadius="sm"
                          />
                        </Link>
                      ) : (
                        <Image
                          src={book.imageUrl || "/album.png"}
                          alt={book.title}
                          width="100%"
                          height={{ base: "180px", md: "220px" }}
                          objectFit="cover"
                          borderRadius="sm"
                        />
                      )}

                      <VStack align="left" gap={1} mt={3}>
                        {book.url ? (
                          <Link
                            as="a"
                            href={book.url}
                            target="_blank"
                            rel="noreferrer"
                            fontWeight="bold"
                            lineHeight="short"
                          >
                            {book.title}
                            <FiExternalLink style={{ display: "inline", marginLeft: "6px" }} />
                          </Link>
                        ) : (
                          <Text fontWeight="bold" lineHeight="short">
                            {book.title}
                          </Text>
                        )}
                        <Text fontSize="sm">{book.author}</Text>
                        <HStack gap={2} align="center" wrap="wrap">
                          <Badge colorPalette="green">{ratingLabel(book.rating)}</Badge>
                          <Text fontSize="xs" color={{ base: "gray.600", _dark: "gray.300" }}>
                            {formatDate(book.readAt)}
                          </Text>
                        </HStack>
                        {book.review ? (
                          <Text
                            fontSize="sm"
                            color={{ base: "gray.700", _dark: "gray.300" }}
                            css={{
                              display: "-webkit-box",
                              WebkitLineClamp: 4,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {book.review}
                          </Text>
                        ) : null}
                      </VStack>
                    </Box>
                  ))}
                </SimpleGrid>
              </Box>
            ))
          : null}
      </VStack>
    </Box>
  );
};
