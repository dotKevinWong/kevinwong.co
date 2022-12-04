import { getNowPlaying } from "../../lib/spotify";

export default async function handler(_, res) {
  const response = await getNowPlaying();

  if (response.status === 204 || response.status > 400) {
    return res.status(200).json({ isPlaying: false });
  }

  const song = await response.json();

  if (song.item === null) {
    return res.status(200).json({ isPlaying: false });
  }

  const isPlaying = song.is_playing;
  const title = song.item.name;
  const artist = song.item.artists.map((_artist) => _artist.name).join(", ");
  const album = song.item.album.name;
  const albumImageUrl = song.item.album.images[0].url;
  const songUrl = song.item.external_urls.spotify;
  const albumUrl = song.item.album.external_urls.spotify;
  const artistUrl = song.item.artists[0].external_urls.spotify;
  const currentDuration = song.progress_ms;
  const totalDuration = song.item.duration_ms;

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=30"
  );

  return res.status(200).json({
    album,
    albumImageUrl,
    artist,
    artistUrl,
    isPlaying,
    songUrl,
    albumUrl,
    title,
    currentDuration,
    totalDuration,
  });
}