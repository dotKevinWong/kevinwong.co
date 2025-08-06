import { Box, Button, Container, Heading, HStack, VStack, Text, Center, Link, Wrap, WrapItem, Separator } from "@chakra-ui/react"
import { FaFacebook, FaGithub, FaInstagram, FaLinkedin, FaYoutube } from "react-icons/fa"
import { FaXTwitter } from "react-icons/fa6"
import { FiKey } from "react-icons/fi"


export const ContactPage = () => {
    return(
    <Container as="section" flex="1" p="6" overflow="auto" maxW="5xl">
        <Box maxW="5xl">
            <VStack align="left" gap={6}>
                <Heading>Contact Me</Heading>
                <Wrap justify='center'>
                    <WrapItem> <Button colorPalette="blue"><FaLinkedin/><a href="https://linkedin.com/in/dotKevinWong" target="_blank" rel="noreferrer"/>LinkedIn</Button></WrapItem>
                    <WrapItem> <Button colorPalette="blue"><FaFacebook/><a href="https://facebook.com/dotKevinWong" target="_blank" rel="noreferrer"/>Facebook</Button></WrapItem>
                    <WrapItem> <Button colorPalette="black"><FaXTwitter/><a href="https://x.com/dotKevinWong" target="_blank" rel="noreferrer"/>X</Button></WrapItem>
                    <WrapItem> <Button colorPalette="pink"><FaInstagram/><a href="https://instagram.com/dotKevinWong" target="_blank" rel="noreferrer"/>Instagram</Button></WrapItem>
                    <WrapItem> <Button colorPalette="green"><FaGithub/><a href="https://github.com/dotKevinWong " target="_blank" rel="noreferrer"/>GitHub</Button></WrapItem>
                    <WrapItem> <Button colorPalette="red"><FaYoutube/><a href="https://youtube.com/c/dotKevinWong" target="_blank" rel="noreferrer"/>YouTube</Button></WrapItem>
                </Wrap>
                <HStack>
                    <Heading fontWeight="bold" size="md">Email:</Heading>
                    <Heading size="md">kevin@kevinwong.co</Heading>
                </HStack>
                <Text colorScheme="gray">If you need to send me information via secure communication, please be sure to use an email client enabled with <strong>Pretty Good Privacy (PGP)</strong> and encrypt your message using my <strong>PGP public key</strong> found below:</Text>
                <Text colorScheme="gray">You can download the full public key from any <strong>major keyserver</strong>, preferably the <a href="https://pgp.mit.edu/pks/lookup?op=get&search=0x10062475CF2EDFB7" target="_blank" rel="noreferrer">MIT PGP keyserver</a>.</Text>
                <Center>
                    <Button asChild colorPalette="blue"><a href="https://pgp.mit.edu/pks/lookup?op=get&search=0x10062475CF2EDFB7" target="_blank" rel="noreferrer"><FiKey/>MIT PGP KEYSERVER</a></Button>
                </Center>
                <Separator orientation='horizontal' />
                <Heading size="md" fontWeight="bold">How to use Pretty Good Privacy (PGP)</Heading>
                <Text colorScheme="gray">To start using Pretty Good Privacy (PGP), you&#39;ll need to install a type of OpenPGP software on your device.  Below you&#39;ll find a list of possible solutions for your operating system:</Text>
                <VStack align="left" gap={2}>
                    <Link fontWeight="bold" as="a" href="https://ssd.eff.org/module/how-use-pgp-windows" target="_blank" rel="noreferrer">Windows</Link>
                    <Link fontWeight="bold" as="a" href="https://gpgtools.tenderapp.com/kb/how-to/first-steps-where-do-i-start-where-do-i-begin-setup-gpgtools-create-a-new-key-your-first-encrypted-mail" target="_blank" rel="noreferrer">macOS</Link>
                    <Link fontWeight="bold" as="a" href="https://ssd.eff.org/en/module/how-use-pgp-linux" target="_blank" rel="noreferrer">Linux</Link>
                    <Link fontWeight="bold" as="a" href="https://itunes.apple.com/app/ipgmail/id430780873?mt=8" target="_blank" rel="noreferrer">iOS</Link>
                    <Link fontWeight="bold" as="a" href="https://play.google.com/store/apps/details?id=org.sufficientlysecure.keychain" target="_blank" rel="noreferrer">Android</Link>
                </VStack>
                <Text colorScheme="gray">Please import the public key into your local OpenPGP Key-Manager.</Text>
                <Separator orientation='horizontal' />
                <VStack align="left" gap={4}>
                    <Text fontWeight="bold">Expires:</Text>
                    <Text>01/01/2026 (MM/DD/YYYY)</Text>
                    <Text fontWeight="bold">Fingerprint:</Text>
                    <VStack align="left" gap={2}>
                        <Text>EC93 2702 D4C5 9E90 0168</Text>
                        <Text>C776 1006 2475 CF2E DFB7</Text>
                    </VStack>
                </VStack>
            </VStack>
        </Box>
    </Container>
    )
}