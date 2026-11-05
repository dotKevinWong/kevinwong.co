import { Heading } from '@chakra-ui/react'
import Link from 'next/link'

/** The "KEVIN WONG" heading that links home, in the Sidebar and the Navbar. */
export const SiteTitle = () => (
  <Heading size="2xl" fontWeight="bold"><Link href="/">KEVIN WONG</Link></Heading>
)
