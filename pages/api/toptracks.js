import { getTopTracks } from "../../lib/spotify";

export default async function handler(_, res) {
  const response = await getTopTracks();

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

    return res.status(200).json({
        tracks,
    });

}