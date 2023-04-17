import { ExternalLinkIcon } from "@chakra-ui/icons"
import { Box, Flex, Image, Text, Badge, Link, useColorModeValue } from "@chakra-ui/react"

interface PhotoPostProps {
    photoSrc: string;
    description: string;
    alt: string;
    date: string;
    sourceHref: string;
    sourceName: string;
}

export const PhotoPost = (props: PhotoPostProps) => {
    return (
        <Box p="5" maxW="320px" minW="320px" borderWidth="1px" minH="320px" rounded={{ sm: 'lg' }}
            shadow={{ md: 'base' }} bg={useColorModeValue('white', 'gray.800')}>
            <Image borderRadius="md" src={props.photoSrc} alt={props.alt} />
            <Flex align="baseline" mt={3}>
                <Badge colorScheme="pink"><Link href={props.sourceHref} target="_blank">{props.sourceName} <ExternalLinkIcon /></Link></Badge>
            </Flex>
            <Text mt={2}>
                {props.description}
            </Text>
            <Text mt={2} fontWeight="light">{props.date}</Text>
        </Box>
    )
}