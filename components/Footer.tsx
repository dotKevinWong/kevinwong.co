import {
  Flex,
  Container,
} from "@chakra-ui/react";
import * as React from 'react'
import useSWR from "swr";
import fetcher from "../lib/fetcher";

export const Footer = () => {
  const { data } = useSWR("/api/nowplaying", fetcher);

  return(
  <Container as="footer">
      <Flex
        justify="space-between"
        align="center"
        fontWeight="medium"
        fontSize="sm"
      >
      </Flex>
  </Container>
  )
}