import Head from "next/head"
import { useRouter } from "next/router"

const SITE_URL = "https://kevinwong.co"
const DEFAULT_DESC = "Developer, Creator, and Entrepreneur"
// public/og.jpg, the only share image whose size is known (1920x1080).
const DEFAULT_OG_IMAGE = `${SITE_URL}/og.jpg`

export const Meta = (props: { title: string, ogImage?: string, ogDesc?: string }) => {
    // This page's own address, without the query or hash (the Projects desktop
    // keeps ?app=… in the URL), so shared links and search engines get the page
    // itself rather than the homepage.
    const { asPath } = useRouter()
    const url = SITE_URL + asPath.split(/[?#]/)[0]
    const desc = props.ogDesc || DEFAULT_DESC
    const image = props.ogImage || DEFAULT_OG_IMAGE

    return (
        <Head>
            <title>{props.title}</title>
            <meta name="description" content={desc} key="desc" />
            <link rel="canonical" href={url} key="canonical" />
            <meta property="og:title" content={props.title} key="og:title" />
            <meta property="og:description" content={desc} key="og:description" />
            <meta property="og:url" content={url} key="og:url" />
            <meta property="og:site_name" content="Kevin Wong" key="og:site_name" />
            <meta property="og:locale" content="en_US" key="og:locale" />
            <meta property="og:image" content={image} key="og:image" />
            <meta property="og:image:secure_url" content={image} key="og:image:secure_url" />
            {/* Blog covers come in other sizes, so only vouch for the default's. */}
            {image === DEFAULT_OG_IMAGE && <meta property="og:image:width" content="1920" key="og:image:width" />}
            {image === DEFAULT_OG_IMAGE && <meta property="og:image:height" content="1080" key="og:image:height" />}
            <meta property="og:type" content="website" key="og:type" />
            <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
            <meta name="twitter:title" content={props.title} key="twitter:title" />
            <link rel="icon" href="/favicon.ico" />
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
    )
}
