import { Sidebar } from "../../components/Sidebar";
import { Box, Flex, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { getAllPosts } from "../../lib/mdx";
import { BlogPage } from "../../components/pages/Blog";
import { Navbar } from "../../components/Navbar";

export default function Blog({ posts }: any) {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    return (
      <div>
        <title>Kevin Wong</title>
        {isDesktop ? (
          <Box height="100vh" overflow="hidden" position="relative">
            <Flex h="full" id="app-container">
              <Sidebar />
              <Box
                as="section"
                flex="1"
                overflow="auto"
              >
                  <BlogPage posts={posts} />
              </Box>
            </Flex>
          </Box>
        ) : (
          <Flex
            as="section"
            direction={{ base: "column", lg: "row" }}
            height="100vh"
            bg="bg-canvas"
            overflowY="auto"
          >
            <Navbar />
            <BlogPage posts={posts} />
          </Flex>
        )}
      </div>
    );
}

// use getStaticProps to get all the posts
export async function getStaticProps() {
    const posts = await getAllPosts();
    return { props: { posts } };
}