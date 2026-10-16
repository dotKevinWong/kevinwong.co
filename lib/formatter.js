export function shortUTCDate(payload) {
	const months = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];

	const date = new Date(payload);

	return (
		months[date.getUTCMonth()] +
		" " +
		date.getUTCDate() +
		", " +
		date.getUTCFullYear()
	);
}
