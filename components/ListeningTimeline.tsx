import React, { useEffect, useRef } from "react";
import { Chart, BarController, LinearScale, CategoryScale, registerables } from 'chart.js'
import useSWR from "swr";
import fetcher from "../lib/fetcher";

export const ListeningTimeline = () => {
    const { data } = useSWR("/api/listeningtimeline", fetcher);
    const chartRef = useRef(null);

    Chart.register(BarController, LinearScale, CategoryScale, ...registerables);

    useEffect(() => {
        // The API answers { is_working: false } when Spotify is unreachable —
        // including once the refresh token hits its six-month expiry. Without
        // this guard that flag gets charted as if it were a date bucket.
        if (!data || data.is_working === false || !chartRef.current) {
            return;
        }

        const labels = Object.keys(data).sort();
        const values = labels.map((date) => data[date].length);

        const chartData = {
            labels: labels,
            datasets: [
                {
                    label: "Listening Timeline",
                    data: values,
                    backgroundColor: "rgba(255, 99, 132, 0.2)",
                    borderColor: "rgba(255, 99, 132, 1)",
                    borderWidth: 1,
                },
            ],
        };

        const chartOptions = {
            type: 'bar' as const,
            data: chartData,
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                    },
                },
            },
        };

        new Chart(chartRef.current, chartOptions);
    }, [data, chartRef]);

    return (
        <div>
            <canvas id="listeningTimeline" width="400" height="400" ref={chartRef}></canvas>
        </div>
    );
};