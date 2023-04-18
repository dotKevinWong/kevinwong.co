import Head from "next/head"

export const Meta = (props: { title: string, ogImage?: string, ogDesc?: string }) => {

    return (
        <Head>
            <title>{props.title}</title>
            <meta name="description" content={props.ogDesc ? props.ogDesc : "Developer, Creator, and Entrepreneur"} key="desc" />
            <meta property="og:title" content={props.title} />
            <meta
                property="og:description"
                content={props.ogDesc ? props.ogDesc : "Developer, Creator, and Entrepreneur"}
            />
            <meta property="og:url" content="https://kevinwong.co" />
            <meta property="og:site_name" content="Kevin Wong" />
            <meta property="og:locale" content="en_US" />
            <meta
                property="og:image"
                content={props.ogImage ? props.ogImage : "http://kevinwong.co/og.jpg"}
            />
            <meta property="og:image:secure_url" content={props.ogImage ? props.ogImage : "https://kevinwong.co/og.jpg"} />
            <meta property="og:image:width" content="1920" />
            <meta property="og:image:height" content="1080" />
            <meta property="og:type" content="website" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={props.title} />
            <link rel="icon" href="/favicon.ico" />
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
    )
}