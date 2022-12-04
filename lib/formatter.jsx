exports.shortUTCDate = function (payload) {
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
};

exports.shortMonthYear = function (payload) {
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];

	const date = new Date(payload);

	return months[date.getMonth()] + " " + date.getFullYear();
};
