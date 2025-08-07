import { Box, Flex, Image, Text, Badge, Link } from "@chakra-ui/react"
import { FiExternalLink, FiInstagram } from "react-icons/fi";

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
            shadow={{ md: 'base' }} bg={{ base: 'gray.100', _dark: '#111111' }}>
            <Image borderRadius="md" src={props.photoSrc} alt={props.alt} />
            <Flex align="baseline" mt={3}>
                <Badge colorPalette="pink"><FiInstagram /><Link href={props.sourceHref} target="_blank">{props.sourceName} <FiExternalLink /></Link></Badge>
            </Flex>
            <Text mt={2} whiteSpace="pre-line">
                {props.description}
            </Text>
            <Text mt={2} fontWeight="light">{props.date}</Text>
        </Box>
    )
}