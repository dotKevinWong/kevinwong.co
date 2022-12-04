import {
  Box,
  Circle,
  Flex,
  Heading,
  HStack,
  VStack,
  Image,
  Text,
  Link,
  useColorModeValue as mode,
  Container,
  Avatar,
} from "@chakra-ui/react";
import * as React from 'react'
import { FaSpotify } from "react-icons/fa";
import { ExternalLinkIcon } from "@chakra-ui/icons";
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