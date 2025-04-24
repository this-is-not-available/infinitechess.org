const scale = 173.7178;
const pi = Math.PI;

function g(RD) {
	return 1 / Math.sqrt(1 + (3 * Math.pow(RD, 2)) / Math.pow(pi, 2));
}

function E(r, ri, RD_i) {
	return 1 / (1 + Math.exp(-g(RD_i) * (r - ri)));
}

/**
 * Calculates the new RD and rating for a player based on all the games that happened since
 * @param player - An object representing the player which includes `rating` and `rd` keys
 * @param opponents - An array containing objects which have the `rating`, `rd` and `score`
 * @returns An object representing the new rating which includes `rating` and `rd` keys
 */
function calculateNewRating(player, opponents) {
	// Step 1: Convert player rating and RD to internal scale
	const r = (player.rating - 1500) / scale;
	const rd = player.rd / scale;

	// Step 2: Compute d^2 (rating variance)
	let d2_inv_sum = 0;
	let delta_sum = 0;

	for (const opp of opponents) {
		const ri = (opp.rating - 1500) / scale;
		const RD_i = opp.rd / scale;
		const g_RD = g(RD_i);
		const E_val = E(r, ri, RD_i);
		
		d2_inv_sum += Math.pow(g_RD, 2) * E_val * (1 - E_val);
		delta_sum += g_RD * (opp.score - E_val);
	}

	const d2 = 1 / d2_inv_sum;

	// Step 3: New rating (r')
	const r_prime = r + (d2 * delta_sum);

	// Step 4: New RD
	const rd_prime = Math.sqrt(1 / (1 / Math.pow(rd, 2) + 1 / d2));

	// Step 5: Convert back to regular scale
	const newRating = r_prime * scale + 1500;
	const newRD = rd_prime * scale;

	return {
		rating: newRating,
		rd: newRD
	};
}


export {
	calculateNewRating
};