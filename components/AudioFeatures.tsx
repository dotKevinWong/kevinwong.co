import React, { useEffect, useRef } from "react";
import { Chart, BarController, LinearScale, CategoryScale, registerables } from 'chart.js'
import { Box, Heading, VStack, Text } from "@chakra-ui/react";
import useSWR from "swr";
import fetcher from "../lib/fetcher";

export const AudioFeatures = () => {
  const { data } = useSWR("/api/audiofeatures", fetcher);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  Chart.register(BarController, LinearScale, CategoryScale, ...registerables);

  useEffect(() => {
    if (!data || !chartRef.current) {
      return;
    }

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const labels = [
      "Danceability",
      "Energy",
      "Valence",
      "Tempo",
      "Acousticness",
      "Instrumentalness",
      "Speechiness",
    ];

    const chartData = {
      labels: labels,
      datasets: data.features.map((feature: { name: any, artist: any, danceability: any; energy: any; valence: any; tempo: number; acousticness: any; instrumentalness: any; speechiness: any; }, index: number) => ({
        label: `Track ${index + 1}`,
        //   label: `${feature.artist} - ${feature.name}`,
        data: [
          feature.danceability,
          feature.energy,
          feature.valence,
          feature.tempo / 100,
          feature.acousticness,
          feature.instrumentalness,
          feature.speechiness,
        ],
        borderColor: `rgba(128, 128, 128, 1)`,
        backgroundColor: [
          'rgba(255, 99, 132, 0.3)',
          'rgba(54, 162, 235, 0.3)',
          'rgba(255, 206, 86, 0.3)',
          'rgba(75, 192, 192, 0.3)',
          'rgba(153, 102, 255, 0.3)',
          'rgba(255, 159, 64, 0.3)',
          'rgba(201, 203, 207, 0.3)',
        ],
        pointBackgroundColor: `hsl(${(index * 360) / data.length}, 100%, 50%)`,
      })),
    };

    const config = {
      type: "polarArea",
      data: chartData,
      options: {
        elements: {
          line: {
            borderWidth: 2,
          },
          point: {
            radius: 3,
          },
        },
      },
    };

    chartInstanceRef.current = new Chart(chartRef.current, config);
  }, [data, chartRef]);

  return (
    <Box maxW="lg">
      <VStack align="left">
        <Heading>Audio Features</Heading>
        <Text maxW="360px">Here are the audio statistics on my current top 10 Spotify tracks</Text>
        <canvas id="audioFeatures" width="400" height="400" ref={chartRef}></canvas>
      </VStack>
    </Box >
  );
};