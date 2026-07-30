import { getTopTracks } from "../../lib/spotify";

export default async function handler(_, res) {
  let response;

  try {
    response = await getTopTracks();
  } catch (error) {
    return res.status(200).json({ is_working: false });
  }

  if (response.status === 204 || !response.ok) {
    return res.status(200).json({ is_working: false });
  }

  const list = await response.json();

  // loop through the list and get the data we need 
    const tracks = list.items.map((item) => {
        return {
            name: item.name,
            artist: item.artists[0].name,
            album: item.album.name,
            albumImageUrl: item.album.images[0].url,
            songUrl: item.external_urls.spotify,
            albumUrl: item.album.external_urls.spotify,
            artistUrl: item.artists[0].external_urls.spotify,
        };

    });

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json({
        tracks,
    });

}