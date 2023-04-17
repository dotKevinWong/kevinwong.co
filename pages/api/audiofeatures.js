import { getTopTracks, getAudioFeatures } from "../../lib/spotify";

export default async function handler(_, res) {
  const topTracks = await getTopTracks();

  if (topTracks.status === 204 || topTracks.status > 400) {
    return res.status(200).json({ is_working: false });
  }

  const topTracksList = await topTracks.json();

  const audioFeatures = await getAudioFeatures(topTracksList.items.map((item) => item.id));

  const audioFeaturesList = await audioFeatures.json()

  // lopp through the top tracks list and audio features list to match the track artist, name, and audio features

  const tracks = topTracksList.items.map((item) => {
    return {
        id: item.id,
        name: item.name,
        artist: item.artists[0].name,
        album: item.album.name,
        albumImageUrl: item.album.images[0].url,
        songUrl: item.external_urls.spotify,
        albumUrl: item.album.external_urls.spotify,
        artistUrl: item.artists[0].external_urls.spotify,
    };
    });

  const features = audioFeaturesList.audio_features.map((item) => {
    return {
        danceability: item.danceability,
        energy: item.energy,
        key: item.key,
        loudness: item.loudness,
        mode: item.mode,
        speechiness: item.speechiness,
        acousticness: item.acousticness,
        instrumentalness: item.instrumentalness,
        liveness: item.liveness,
        valence: item.valence,
        tempo: item.tempo,
        type: item.type,
        id: item.id,
        uri: item.uri,
        track_href: item.track_href,
        analysis_url: item.analysis_url,
        duration_ms: item.duration_ms,
        time_signature: item.time_signature,
    };
    });

    const combined = tracks.map((track, index) => {
        return {
            ...track,
            ...features[index]
        }
    })


    return res.status(200).json({
        features: combined
    });

}