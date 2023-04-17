import { getListeningTimeline } from "../../lib/spotify";

export default async function handler(_, res) {
  const response = await getListeningTimeline();

  if (response.status === 204 || response.status > 400) {
    return res.status(200).json({ is_working: false });
  }

  const recentlyPlayed = await response.json();
  const timeline = {};

  for (const item of recentlyPlayed.items) {
    const playedAt = new Date(item.played_at);
    const dateKey = playedAt.toISOString().split("T")[0];

    if (!timeline[dateKey]) {
      timeline[dateKey] = [];
    }

    timeline[dateKey].push({
      track: item.track.name,
      artist: item.track.artists.map((artist) => artist.name).join(", "),
      album: item.track.album.name,
      playedAt: playedAt,
    });
  }
  return res.status(200).json(timeline);
}